const {
  default: makeWASocket,
  MessageType,
  MessageOptions,
  Mimetype,
  DisconnectReason,
  BufferJSON,
  AnyMessageContent,
  delay,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  makeCacheableSignalKeyStore,
  makeInMemoryStore,
  MessageRetryMap,
  useMultiFileAuthState,
  msgRetryCounterMap,
} = require("@whiskeysockets/baileys");
const https = require("https");

const log = (pino = require("pino"));
const { session } = { session: "session_auth_info" };
const { Boom } = require("@hapi/boom");
const path = require("path");
const fs = require("fs");
const express = require("express");
const fileUpload = require("express-fileupload");
const cors = require("cors");
const bodyParser = require("body-parser");
const app = require("express")();
// enable files upload
app.use(
  fileUpload({
    createParentPath: true,
  })
);

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const port = process.env.PORT || 4030;
const qrcode = require("qrcode");

app.use("/assets", express.static(__dirname + "/client/assets"));

app.get("/scan", (req, res) => {
  res.sendFile("./client/index.html", {
    root: __dirname,
  });
});

app.get("/", (req, res) => {
  res.send("server working");
});

let sock;
let qrDinamic;
let soket;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("session_auth_info");

  sock = makeWASocket({
    printQRInTerminal: false,
    auth: state,
    logger: log({ level: "silent" }),
    qrTimeout: 60 * 1000,
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    qrDinamic = qr;
    if (connection === "close") {
      let reason = new Boom(lastDisconnect.error).output.statusCode;
      if (reason === DisconnectReason.badSession) {
        console.log(
          `Bad Session File, Please Delete ${session} and Scan Again`
        );
        sock.logout();
      } else if (reason === DisconnectReason.connectionClosed) {
        console.log("Conexión cerrada, reconectando....");
        connectToWhatsApp();
      } else if (reason === DisconnectReason.connectionLost) {
        console.log("Conexión perdida del servidor, reconectando...");
        connectToWhatsApp();
      } else if (reason === DisconnectReason.connectionReplaced) {
        console.log(
          "Conexión reemplazada, otra nueva sesión abierta, cierre la sesión actual primero"
        );
        sock.logout();
      } else if (reason === DisconnectReason.loggedOut) {
        console.log(
          `Dispositivo cerrado, elimínelo ${session} y escanear de nuevo.`
        );
        sock.logout();
      } else if (reason === DisconnectReason.restartRequired) {
        console.log("Se requiere reinicio, reiniciando...");
        connectToWhatsApp();
      } else if (reason === DisconnectReason.timedOut) {
        console.log("Se agotó el tiempo de conexión, conectando...");
        connectToWhatsApp();
      } else {
        sock.end(
          `Motivo de desconexión desconocido: ${reason}|${lastDisconnect.error}`
        );
      }
    } else if (connection === "open") {
      console.log("conexión abierta");
      return;
    }
  });

  sock.ev.on("creds.update", saveCreds);

  //Recibir mensajes revisados y responder
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    try {
      if (type === "notify") {
        if (
          !messages[0]?.key.fromMe &&
          !messages[0].message?.protocolMessage?.disappearingMode &&
          !messages[0].message?.protocolMessage?.ephemeralExpiration
        ) {
          //Validar msg viene en distinto lugar
          let captureMessage = "vacio";
          if (messages[0]?.message?.extendedTextMessage?.text) {
            captureMessage = messages[0]?.message?.extendedTextMessage?.text;
          } else if (messages[0]?.message?.conversation) {
            captureMessage = messages[0]?.message?.conversation;
          }

          console.log(captureMessage);
          if (captureMessage !== "vacio") {
            const numberWa = messages[0]?.key?.remoteJid;

            //extrar numero
            const regexNumber = /(\d+)/;
            const matchNumber = numberWa.match(regexNumber);
            if (matchNumber) {
              phoneNumber = matchNumber[1];
            } else {
              phoneNumber = "";
            }

            //Verificar si es usuario o grupo
            const regex = /^.*@([sg]).*$/;
            const match = numberWa.match(regex);
            let cliente = false;
            if (match) {
              switch (match[1]) {
                case "s":
                  cliente = true;
                  break;
                case "g":
                  cliente = false;
                  break;
                default:
                  cliente = false;
                  break;
              }
            } else {
              cliente = false;
            }

            //Solo numero de Deyssi envios desde mi pc
            const fetch = require("node-fetch");
            // if (cliente && phoneNumber !== '' && phoneNumber == "593981773526") {
            if (cliente && phoneNumber !== "") {
              // Preparar los datos a enviar al webhook
              const data = JSON.stringify({
                empresa: "sigcrm_clinicasancho",
                name: phoneNumber,
                description: captureMessage,
              });

              const options = {
                hostname: "sigcrm.pro",
                path: "/response-baileys",
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Content-Length": data.length,
                },
              };

              const req = https.request(options, (res) => {
                let responseData = "";

                res.on("data", (chunk) => {
                  responseData += chunk;
                });

                res.on("end", () => {
                  // console.log("Response:", responseData);
                });
              });

              req.on("error", (error) => {
                console.error("Error:", error);
              });

              // Escribe los datos al cuerpo de la solicitud
              req.write(data);
              req.end();

              // await sock.sendMessage(
              //   numberWa,
              //   {
              //     text: "whatsapp on",
              //   },
              //   {
              //     quoted: messages[0],
              //   }
              // );
            }
          }
        }
      }
    } catch (error) {
      console.log("error ", error);
    }
  });
}

//Enviar mensajes revisada
app.post("/send-message", async (req, res) => {
  const { number, tempMessage } = req.body;
  // console.log(number);
  // console.log(tempMessage);
  let numberWA;
  try {
    if (!number) {
      res.status(500).json({
        status: false,
        response: "El numero no existe",
      });
    } else {
      numberWA = number + "@s.whatsapp.net";

      if (isConnected()) {
        const exist = await sock.onWhatsApp(numberWA);

        if (exist?.jid || (exist && exist[0]?.jid)) {
          sock
            .sendMessage(exist.jid || exist[0].jid, {
              text: tempMessage,
            })
            .then((result) => {
              res.status(200).json({
                status: true,
                response: result,
              });
            })
            .catch((err) => {
              res.status(500).json({
                status: false,
                response: err,
              });
            });
        }
      } else {
        res.status(500).json({
          status: false,
          response: "Aun no estas conectado",
        });
      }
    }
  } catch (err) {
    res.status(500).send(err);
  }
});

//Enviar mensajes Multimedia type (image, video, audio, location)
app.post("/send-message-media", async (req, res) => {
  const { number, tempMessage, link, type, latitud, longitud } = req.body;

  // console.log(number);
  // console.log(tempMessage);
  // console.log(link);
  // console.log(type);
  // console.log(latitud);
  // console.log(longitud);

  let numberWA;
  try {
    if (!number) {
      res.status(500).json({
        status: false,
        response: "El numero no existe",
      });
    } else {
      numberWA = number + "@s.whatsapp.net";

      if (isConnected()) {
        const exist = await sock.onWhatsApp(numberWA);

        if (exist?.jid || (exist && exist[0]?.jid)) {
          const fechaActual = new Date();
          const año = fechaActual.getFullYear();
          const mes = String(fechaActual.getMonth() + 1).padStart(2, "0");
          const dia = String(fechaActual.getDate()).padStart(2, "0");
          const nombreArchivo = `${año}-${mes}-${dia}.pdf`;

          switch (type) {
            case "image":
              sock
                .sendMessage(exist.jid || exist[0].jid, {
                  image: {
                    url: link,
                  },
                  caption: tempMessage,
                })
                .then((result) => {
                  res.status(200).json({
                    status: true,
                    response: result,
                  });
                })
                .catch((err) => {
                  res.status(500).json({
                    status: false,
                    response: err,
                  });
                });
              break;
            case "video":
              sock
                .sendMessage(exist.jid || exist[0].jid, {
                  video: {
                    url: link,
                  },
                  caption: tempMessage,
                  gifPlayback: true,
                  ptv: false,
                })
                .then((result) => {
                  res.status(200).json({
                    status: true,
                    response: result,
                  });
                })
                .catch((err) => {
                  res.status(500).json({
                    status: false,
                    response: err,
                  });
                });
              break;
            case "audio":
              sock
                .sendMessage(exist.jid || exist[0].jid, {
                  audio: {
                    url: link,
                  },
                })
                .then((result) => {
                  res.status(200).json({
                    status: true,
                    response: result,
                  });
                })
                .catch((err) => {
                  res.status(500).json({
                    status: false,
                    response: err,
                  });
                });
              break;
            case "location":
              sock
                .sendMessage(exist.jid || exist[0].jid, {
                  location: {
                    degreesLatitude: latitud,
                    degreesLongitude: longitud,
                  },
                })
                .then((result) => {
                  res.status(200).json({
                    status: true,
                    response: result,
                  });
                })
                .catch((err) => {
                  res.status(500).json({
                    status: false,
                    response: err,
                  });
                });
              break;
            case "document":
              sock
                .sendMessage(exist.jid || exist[0].jid, {
                  document: {
                    url: link,
                    fileName: nombreArchivo,
                  },
                  caption: tempMessage,
                })
                .then((result) => {
                  res.status(200).json({
                    status: true,
                    response: result,
                  });
                })
                .catch((err) => {
                  res.status(500).json({
                    status: false,
                    response: err,
                  });
                });
              break;
            default:
              sock
                .sendMessage(exist.jid || exist[0].jid, {
                  text: tempMessage,
                })
                .then((result) => {
                  res.status(200).json({
                    status: true,
                    response: result,
                  });
                })
                .catch((err) => {
                  res.status(500).json({
                    status: false,
                    response: err,
                  });
                });
              break;
          }
        }
      } else {
        res.status(500).json({
          status: false,
          response: "Aun no estas conectado",
        });
      }
    }
  } catch (err) {
    res.status(500).send(err);
  }
});

const isConnected = () => {
  return sock?.user ? true : false;
};

io.on("connection", async (socket) => {
  soket = socket;
  socket.on("updateData", () => {
    if (isConnected()) {
      updateQR("connected");
    } else if (qrDinamic) {
      updateQR("qr");
    }
  });
});

const updateQR = (data) => {
  switch (data) {
    case "qr":
      qrcode.toDataURL(qrDinamic, (err, url) => {
        soket?.emit("qr", url);
        soket?.emit("log", "QR recibido , scan");
      });
      break;
    case "connected":
      soket?.emit("qrstatus", "./assets/check.svg");
      soket?.emit("log", " usaario conectado");
      const { id, name } = sock?.user;
      var userinfo = id + " " + name;
      soket?.emit("user", userinfo);

      break;
    case "loading":
      soket?.emit("qrstatus", "./assets/loader.gif");
      soket?.emit("log", "Cargando ....");

      break;
    default:
      break;
  }
};

connectToWhatsApp().catch((err) => console.log("unexpected error: " + err));
server.listen(port, () => {
  console.log("Server Run Port : " + port);
});
