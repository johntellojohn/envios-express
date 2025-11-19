const {
  default: makeWASocket,
  MessageType,
  MessageOptions,
  Mimetype,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const https = require("https");

const dotenv = require("dotenv");
dotenv.config();

const log = (pino = require("pino"));
const { Boom } = require("@hapi/boom");
const path = require("path");
const fs = require("fs");
const express = require("express");
const fileUpload = require("express-fileupload");
const cors = require("cors");
const bodyParser = require("body-parser");
const app = require("express")();
const moment = require("moment-timezone");

/* Importaciones para registrar clientes */
const connectToMongoDB = require("./functions/connect-mongodb");
const mongoAuthState = require("./mongoAuthState");

// enable files upload
app.use(
  fileUpload({
    createParentPath: true,
  })
);

app.use(cors());
// app.use(bodyParser.json());
// app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const port = process.env.PORT || 4010;
const qrcode = require("qrcode");

// Variables para el sock
let db;
let whatsapp_registros;
let sock;
let qrDinamic;
let soket;
let WhatsAppSessions = {};

app.use(express.static(path.join(__dirname, "client")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "client", "index.html"));
});

/* Endpoint para escanear el QR */
app.get("/scan", async (req, res) => {
  const { id_externo } = req.query;

  if (!id_externo) {
    return res.status(400).send("ID externo es necesario");
  }

  try {
    const userRecord = await getUserRecordByIdExterno(id_externo);

    if (!userRecord) {
      return res.status(404).send("Registro no encontrado");
    }

    res.sendFile(path.join(__dirname, "client", "index.html"));
  } catch (error) {
    console.error("Error al obtener registros:", error);
    return res.status(500).send("Error interno del servidor");
  }
});

/* Endpoint para revisar los registros creados */
app.get("/registros", async (req, res) => {
  try {
    const registros = await getUserRecords();

    // Filtramos los campos '_id' y 'qr' del resultado
    const registrosFiltrados = registros.map((registro) => {
      const { _id, qr, ...registroSinIdYQR } = registro;
      return registroSinIdYQR;
    });

    console.log(
      `---------------------------------- Registros Encontrados ----------------------------------`
    );
    res.json({
      result: true,
      success: "datos obtenidos",
      data: registrosFiltrados,
    });
  } catch (err) {
    console.error("********************* Error al obtener registros:", err);
    res.status(500).json({
      result: false,
      success: "",
      error: "Error al obtener registros",
    });
  }
});

/* Endpoint para crear un nuevo usuario */
app.post("/crear-usuario", async (req, res) => {
  const { nombre, id_externo, descripcion, receive_messages } = req.body;

  try {
    const registroExistente = await getUserRecordByIdExterno(id_externo);

    if (!registroExistente) {
      if (nombre && id_externo && typeof receive_messages === "boolean") {
        const registros = db.collection("registros_whatsapp");
        const nuevoRegistro = {
          nombre,
          id_externo,
          descripcion,
          fechaCreacion: new Date(),
          receive_messages,
        };

        await registros.insertOne(nuevoRegistro);

        const sessionId = await connectToWhatsApp(id_externo, receive_messages);
        nuevoRegistro.sock = sessionId;

        await updateUserRecord(id_externo, {
          sock: sessionId,
        });

        res.json({
          result: true,
          success: "Usuario creado correctamente",
          sessionId: sessionId,
          registro: nuevoRegistro,
        });
      } else {
        res.status(400).send({
          result: false,
          error:
            "Por favor, proporciona un nombre, un identificador y si quieres enviar y recibir mensajes",
        });
      }
    } else {
      res.status(400).send({
        result: false,
        error: "Ya existe un registro con el mismo identificador",
      });
    }
  } catch (err) {
    console.error("Error detallado:", err);
    res.status(500).json({
      result: false,
      error: `Error al crear registro: ${err.message}`,
    });
  }
});

/* Endpoint para actualizar un registro */
app.put("/actualizar-usuario/:id_externo", async (req, res) => {
  const { id_externo } = req.params;
  const { receive_messages } = req.body;

  if (receive_messages === undefined) {
    return res.status(400).json({
      result: false,
      error: "Se requiere el campo recibir mensajes(recive_messages)",
    });
  }

  try {
    const userRecord = await getUserRecordByIdExterno(id_externo);

    if (!userRecord) {
      return res.status(404).json({
        result: false,
        error: "No se encontró un usuario con el id_externo",
      });
    }

    await updateUserRecord(id_externo, { receive_messages: receive_messages });

    // Si es necesario, reiniciar la conexión de WhatsApp
    if (receive_messages) {
      const sessionId = await connectToWhatsApp(id_externo, receive_messages);
      await updateUserRecord(id_externo, { sock: sessionId });
    }

    res.json({
      result: true,
      success: "El valor de receive_messages fue actualizado correctamente",
    });
  } catch (err) {
    console.error("Error detallado:", err);
    res.status(500).json({
      result: false,
      error: `Error al actualizar receive_messages: ${err.message}`,
    });
  }
});

/* Endpoint para realizar el envio de mensajes */
app.post("/send-message/:id_externo", async (req, res) => {
  const { id_externo } = req.params;
  const { number, tempMessage, pdfBase64 } = req.body;

  let numberWA;
  try {
    if (!number) {
      return res.status(500).json({
        status: false,
        response: "El numero no existe",
      });
    } else {
      numberWA = number + "@s.whatsapp.net";

      const sockUser = WhatsAppSessions[id_externo]?.sock;

      if (sockUser) {
        const estadoSock = sockUser?.ws?.socket?._readyState;

        if (estadoSock !== 1) {
          console.log("Implementando reconexión...");
          await connectToWhatsApp(id_externo, receiveMessages);
          sockUser = WhatsAppSessions[id_externo]?.sock;
        }

        const exist = await sockUser.onWhatsApp(numberWA);

        if (exist?.jid || (exist && exist[0]?.jid)) {
          try {
            const result = await sockUser.sendMessage(
              exist.jid || exist[0].jid,
              {
                text: tempMessage,
              }
            );

            const senderJid = sockUser.user.id;
            const senderNumber = senderJid.split(":")[0];

            const recipientJid = exist.jid || exist[0].jid;
            const recipientNumber = recipientJid.split("@")[0];

            const fechaServidor = moment()
              .tz("America/Guayaquil")
              .format("YYYY-MM-DD HH:mm:ss");

            console.log({
              De: "cliente-" + id_externo,
              Para: numberWA,
              EnviadoPor: senderNumber,
              Message: tempMessage,
              Fecha: fechaServidor,
            });

            return res.status(200).json({
              status: true,
              response: {
                result,
                senderNumber: senderNumber,
                recipientNumber: recipientNumber,
              },
            });
          } catch (err) {
            console.error("Error al enviar mensaje:", err);
            return res.status(500).json({
              status: false,
              response: err.message || "Error al enviar mensaje",
            });
          }
        } else {
          return res.status(404).json({
            status: false,
            response: "El número no está en WhatsApp",
          });
        }
      } else {
        return res.status(500).json({
          status: false,
          response: "No existe un sock para el usuario",
        });
      }
    }
  } catch (err) {
    res.status(500).send(err);
  }
});

/* Endpoint para mostrar la informacion del usuario */
app.get("/view-user/:id_externo", async (req, res) => {
  const { id_externo } = req.params;

  try {
    const connected = await isConnected(id_externo);
    const sockUser = WhatsAppSessions[id_externo]?.sock;

    if (connected) {
      const userId = sockUser?.user?.id;
      const userName = sockUser?.user?.name;

      console.log("--------- INFORMACION DEL cliente-6IE ENTREGADA ---------");
      res.json({ result: true, userId, userName });
    } else {
      res.status(500).json({
        status: false,
        response: "Aun no estas conectado",
      });
    }
  } catch (err) {
    res.status(500).send(err);
  }
});

/* Endpoint para eliminar un usuario */
app.delete("/eliminar-usuario/:id_externo", async (req, res) => {
  const { id_externo } = req.params;

  try {
    const registros = await getUserRecords();

    if (!registros) {
      res.status(400).json({
        result: false,
        error: "No existen aun registros",
      });
    }

    if (id_externo) {
      await removeRegistro(id_externo);

      console.log(
        `---------------------------------- SE ELIMINARON LAS FUNCIONES PARA ${id_externo} ----------------------------------`
      );
      res.json({
        result: true,
        id: id_externo,
        success: "Registro eliminado correctamente",
        error: "",
      });
    } else {
      res.status(400).json({
        result: false,
        success: "",
        error: "Debe especificar el id_externo del usuario.",
      });
    }
  } catch (err) {
    console.error("Error detallado:", err);
    res.status(500).json({
      result: false,
      error: `Error al eliminar el registro: ${err.message}`,
    });
  }
});

async function removeRegistro(id_externo) {
  try {
    const sessionName = `session_auth_info_${id_externo}`;

    if (WhatsAppSessions[id_externo] && WhatsAppSessions[id_externo].sock) {
      const sock = WhatsAppSessions[id_externo].sock;

      try {
        if (sock?.ws?.socket?._readyState === 1) {
          sock.logout();
          sock.end();
          console.log(`Conexión cerrada para el ID ${id_externo}`);
        } else {
          console.log(
            `Socket para ${id_externo} parece estar ya cerrado o inválido.`
          );
        }
      } catch (socketError) {
        console.error(`Error cerrando socket para ${id_externo}:`, socketError);
      } finally {
        delete WhatsAppSessions[id_externo];
      }
    }

    try {
      // Eliminar registro del usuario de MongoDB
      const deleteResult = await whatsapp_registros.deleteOne({
        id_externo: id_externo,
      });

      if (deleteResult.deletedCount === 0) {
        console.warn(
          `No se encontró un registro en MongoDB con id_externo: ${id_externo}`
        );
      } else {
        console.log(
          `Registro con id_externo ${id_externo} eliminado correctamente.`
        );
      }
    } catch (dbError) {
      console.error(
        `Error eliminando registro de usuario de MongoDB:`,
        dbError
      );
    }

    try {
      // Eliminar colección de sesión (de forma más robusta)
      const collections = await db
        .listCollections({ name: sessionName })
        .toArray()
        .catch((err) => {
          throw new Error(`Error al listar colecciones: ${err.message}`);
        });

      if (collections.length > 0) {
        await db
          .collection(sessionName)
          .drop()
          .then(() => {
            console.log(`Colección ${sessionName} eliminada correctamente.`);
          })
          .catch((err) => {
            throw new Error(`Error al eliminar colección: ${err.message}`);
          });
      } else {
        console.log(`La colección ${sessionName} no existe.`);
      }
    } catch (collectionError) {
      console.error(`Error eliminando colección de sesión:`, collectionError);
    }
  } catch (error) {
    console.error(
      `Error en removeRegistro con id_externo ${id_externo}:`,
      error
    );
  }
}

async function connectToWhatsApp(id_externo, receiveMessages) {
  const sessionCollection = `session_auth_info_${id_externo}`;
  const collection_session = db.collection(sessionCollection);

  try {
    const { state, saveCreds } = await mongoAuthState(collection_session);

    const sock = makeWASocket({
      printQRInTerminal: false,
      auth: state,
      logger: log({ level: "silent" }),
      qrTimeout: 60 * 1000,
      // browser: ["Windows", "Chrome", "11.3"],
      browser: ["WhatsApp Web", "Chrome", "2.2414.3"],
    });

    sock.ev.on("connection.update", async (update) => {
      await handleConnectionUpdate(update, id_externo, sock, receiveMessages);
    });

    // sock.ev.on("connection.update", async (update) => {
    //   try {
    //     const { connection, lastDisconnect, qr } = update;
    //     let previousQR = update.qr;

    //     try {
    //       // Try-catch around database operations
    //       const userRecord = await getUserRecordByIdExterno(id_externo);

    //       if (userRecord) {
    //         if (
    //           userRecord.sock?.qr !== undefined &&
    //           userRecord.sock?.qr !== null
    //         ) {
    //           previousQR = userRecord.sock?.qr;
    //         }

    //         await updateUserRecord(id_externo, {
    //           sock: {
    //             connection: connection || null,
    //             lastDisconnect: lastDisconnect || null,
    //             qr: qr || previousQR || null,
    //           },
    //         });
    //       }
    //     } catch (dbError) {
    //       console.error(
    //         "Error actualizando registro de usuario en connection.update:",
    //         dbError
    //       );
    //     }

    //     if (qr) {
    //       console.log(`QR generado para el usuario: ${id_externo}`);
    //       WhatsAppSessions[id_externo] = {
    //         sock: sock,
    //       };
    //     }

    //     if (connection === "connecting") return;

    //     if (connection === "close") {
    //       console.log("Conexión cerrada detectada");
    //       const reason = lastDisconnect?.error?.output?.statusCode;

    //       if (reason !== DisconnectReason.loggedOut) {
    //         setTimeout(async () => {
    //           if (WhatsAppSessions[id_externo]) {
    //             await connectToWhatsApp(id_externo, receiveMessages);
    //           } else {
    //             console.log(
    //               `Sesión eliminada para el ID ${id_externo}, no se reconectará.`
    //             );
    //           }
    //         }, 5000);
    //       } else if (reason === DisconnectReason.loggedOut) {
    //         console.log(
    //           `Dispositivo cerrado. Elimine la sesión y escanee nuevamente.`
    //         );
    //         await removeRegistro(id_externo);
    //       }
    //     } else if (connection === "open") {
    //       console.log(`Conexión abierta para el id: ${id_externo}`);

    //       try {
    //         const userRecord = await getUserRecordByIdExterno(id_externo);
    //         if (userRecord) {
    //           await updateUserRecord(id_externo, { estado: "conectado" });
    //         }
    //       } catch (dbError) {
    //         console.error(
    //           `Error actualizando estado de conexión para ${id_externo}:`,
    //           dbError
    //         );
    //       }

    //       if (WhatsAppSessions[id_externo]) {
    //         console.log(
    //           `Reemplazando el socket existente para el id: ${id_externo}`
    //         );
    //         try {
    //           // WhatsAppSessions[id_externo].sock.end();
    //           await WhatsAppSessions[id_externo].sock.ws.close();
    //         } catch (socketEndError) {
    //           console.error(
    //             `Error cerrando el socket anterior:`,
    //             socketEndError
    //           );
    //         }
    //       }

    //       WhatsAppSessions[id_externo] = {
    //         sock: sock,
    //       };

    //       return;
    //     }
    //   } catch (error) {
    //     console.error(`Error en connection.update para ${id_externo}:`, error);
    //   }
    // });

    sock.ev.on("creds.update", saveCreds);

    if (receiveMessages) {
      sock.ev.on("messages.upsert", async ({ messages, type }) => {
        try {
          if (type === "notify") {
            const senderJid = messages[0].key.remoteJid;
            const isGroup = senderJid.endsWith("@g.us"); // Verifica si es un grupo
            const senderNumber = isGroup
              ? messages[0].key.participant?.split("@")[0]
              : senderJid.split("@")[0]; // Maneja grupos y mensajes individuales

            const reciberNumber = sock.user.id.split(":")[0];

            if (
              !messages[0]?.key.fromMe &&
              !messages[0].message?.protocolMessage?.disappearingMode &&
              !messages[0].message?.protocolMessage?.ephemeralExpiration
            ) {
              //Validar msg viene en distinto lugar
              let captureMessage = "vacio";
              let content =
                messages[0]?.message?.ephemeralMessage?.message ||
                messages[0]?.message;

              if (content?.extendedTextMessage?.text) {
                captureMessage = content?.extendedTextMessage?.text;
              } else if (content?.conversation) {
                captureMessage = content?.conversation;
              }

              // console.log(captureMessage);

              console.log(messages);
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
                    senderNumber: senderNumber,
                    reciberNumber: reciberNumber,
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

                  // console.log(`[${new Date().toLocaleString()}] se debio enviar lo que se recibio`);

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
  } catch (initialConnectionError) {
    console.error(
      "Error durante la inicializacion de la conexion WhatsApp:",
      initialConnectionError
    );
  }
}

/**
 * Maneja las actualizaciones del estado de conexión
 */
async function handleConnectionUpdate(
  update,
  id_externo,
  sock,
  receiveMessages
) {
  try {
    const { connection, lastDisconnect, qr } = update;

    // Actualizar información en base de datos
    await updateConnectionStatus(id_externo, connection, lastDisconnect, qr);

    // Manejar código QR
    if (qr) {
      handleQRGeneration(id_externo, sock);
      return;
    }

    // Estado: Conectando
    if (connection === "connecting") {
      console.log(`Conectando WhatsApp para: ${id_externo}`);
      return;
    }

    // Estado: Conexión cerrada
    if (connection === "close") {
      await handleConnectionClose(id_externo, lastDisconnect, receiveMessages);
      return;
    }

    // Estado: Conexión abierta
    if (connection === "open") {
      await handleConnectionOpen(id_externo, sock);
      return;
    }
  } catch (error) {
    console.error(`Error en connection.update para ${id_externo}:`, error);
  }
}

/**
 * Actualiza el estado de conexión en la base de datos
 */
async function updateConnectionStatus(
  id_externo,
  connection,
  lastDisconnect,
  qr
) {
  try {
    const userRecord = await getUserRecordByIdExterno(id_externo);

    if (!userRecord) {
      console.warn(`Usuario ${id_externo} no encontrado en DB`);
      return;
    }

    // Preservar QR previo si no hay uno nuevo
    const previousQR = userRecord.sock?.qr;

    await updateUserRecord(id_externo, {
      sock: {
        connection: connection || null,
        lastDisconnect: lastDisconnect || null,
        qr: qr || previousQR || null,
      },
    });
  } catch (error) {
    console.error(
      `Error actualizando estado de conexión para ${id_externo}:`,
      error
    );
  }
}

/**
 * Maneja la generación de código QR
 */
function handleQRGeneration(id_externo, sock) {
  console.log(`✔️ Conexión abierta para: ${id_externo}`);

  WhatsAppSessions[id_externo] = {
    sock: sock,
    connectedAt: null,
    qrGeneratedAt: Date.now(),
  };
}

/**
 * Maneja el cierre de conexión
 */
async function handleConnectionClose(
  id_externo,
  lastDisconnect,
  receiveMessages
) {
  console.log(`❌ Conexión cerrada para: ${id_externo}`);

  const statusCode = lastDisconnect?.error?.output?.statusCode;
  const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

  if (shouldReconnect) {
    console.log(
      `🔄 Reconectando en 5s para: ${id_externo} (Razón: ${statusCode})`
    );

    setTimeout(async () => {
      if (WhatsAppSessions[id_externo]) {
        await connectToWhatsApp(id_externo, receiveMessages);
      } else {
        console.log(`Sesión eliminada para ${id_externo}, no se reconectará`);
      }
    }, 5000);
  } else {
    console.log(`Usuario ${id_externo} cerró sesión, eliminando registro`);
    await removeRegistro(id_externo);
    delete WhatsAppSessions[id_externo];
  }
}

/**
 * Maneja la apertura exitosa de conexión
 */
async function handleConnectionOpen(id_externo, sock) {
  console.log(`✔️ Conexión establecida para: ${id_externo}`);

  try {
    // Actualizar estado en DB
    const userRecord = await getUserRecordByIdExterno(id_externo);
    if (userRecord) {
      await updateUserRecord(id_externo, { estado: "conectado" });
    }

    // Cerrar socket anterior si existe
    await closeExistingSocket(id_externo);

    // Guardar nueva sesión
    WhatsAppSessions[id_externo] = {
      sock: sock,
      connectedAt: Date.now(),
      qrGeneratedAt: null,
    };
  } catch (error) {
    console.error(`Error al establecer conexión para ${id_externo}:`, error);
  }
}

/**
 * Cierra un socket existente de forma segura
 */
async function closeExistingSocket(id_externo) {
  const existingSession = WhatsAppSessions[id_externo];

  if (!existingSession) return;

  console.log(`Cerrando socket anterior para: ${id_externo}`);

  try {
    if (existingSession.sock?.ws) {
      await existingSession.sock.ws.close();
    }
  } catch (error) {
    console.error(`Error cerrando socket anterior para ${id_externo}:`, error);
  }
}

//Enviar mensajes Multimedia type (image, video, audio, location)
app.post("/send-message-media/:id_externo", async (req, res) => {
  const { number, tempMessage, link, type, latitud, longitud, file } = req.body;
  // const id_externo = req.params.id;
  const { id_externo } = req.params;

  let numberWA;
  let result;

  try {
    if (!number) {
      res.status(500).json({
        status: false,
        response: "El numero no existe",
      });
    } else {
      numberWA = number + "@s.whatsapp.net";

      const sockUser = WhatsAppSessions[id_externo]?.sock;

      if (sockUser) {
        // Verificamos el estado del sock
        const estadoSock = sockUser?.ws?.socket?._readyState;

        if (estadoSock !== 1) {
          console.log("Implementando reconexión...");
          await connectToWhatsApp(id_externo); // Llamar a la función de reconexión
          sockUser = WhatsAppSessions[id_externo]?.sock;
        }

        const exist = await sockUser.onWhatsApp(numberWA);

        if (exist?.jid || (exist && exist[0]?.jid)) {
          try {
            const senderJid = sockUser.user.id;
            const senderNumber = senderJid.split(":")[0];

            const recipientJid = exist.jid || exist[0].jid;
            const recipientNumber = recipientJid.split("@")[0];

            const fechaServidor = moment()
              .tz("America/Guayaquil")
              .format("YYYY-MM-DD HH:mm:ss");

            switch (type) {
              case "image":
                await sockUser
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
                await sockUser
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
                await sockUser
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
                await sockUser
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
                const pathname = new URL(link).pathname;
                const nombreArchivo = decodeURIComponent(
                  pathname.substring(pathname.lastIndexOf("/") + 1)
                );

                await sockUser
                  .sendMessage(exist.jid || exist[0].jid, {
                    document: {
                      url: link,
                      mimetype: "application/pdf",
                    },
                    fileName: nombreArchivo,
                    caption: tempMessage,
                  })
                  .then((result) => {
                    res.status(200).json({ status: true, response: result });
                  })
                  .catch((err) => {
                    res.status(500).json({ status: false, response: err });
                  });
                break;
              case "documentBase64":
                const pdfBuffer = Buffer.from(link, "base64");
                await sockUser
                  .sendMessage(exist.jid || exist[0].jid, {
                    document: pdfBuffer,
                    mimetype: "application/pdf",
                    fileName: file + ".pdf",
                    // caption: "Agenda diaria en PDF",
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
                await sockUser
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

            console.log({
              De: "cliente-" + id_externo,
              Para: numberWA,
              EnviadoPor: senderNumber,
              Message: tempMessage,
              Fecha: fechaServidor,
            });
          } catch (err) {
            console.error("Error al enviar mensaje:", err);
            return res.status(500).json({
              status: false,
              response: err.message || "Error al enviar mensaje",
            });
          }
        }
      } else {
        return res.status(500).json({
          status: false,
          response: "No existe un sock para el usuario",
        });
      }
    }
  } catch (err) {
    res.status(500).send(err);
  }
});

const isConnected = async (id_externo) => {
  try {
    // Verificar si el sock está conectado
    const userSock = WhatsAppSessions[id_externo]?.sock?.user ? true : false;

    if (userSock) {
      console.log(`Usuario ${id_externo} está conectado.`);
      return true;
    } else {
      console.log(`Sock no encontrado para el usuario: ${id_externo}`);
      return false;
    }
  } catch (error) {
    console.error("Error al verificar conexión:", error);
    return false;
  }
};

io.on("connection", async (socket) => {
  soket = socket;

  socket.on("joinSession", async (id_externo) => {
    const userRecord = await getUserRecordByIdExterno(id_externo);
    if (!userRecord) {
      console.error(
        `No se encontró un registro para id_externo: ${id_externo}`
      );
      return;
    }

    qrDinamic = userRecord.sock.qr;
    socket.id_externo = id_externo;

    const connected = await isConnected(id_externo);

    if (connected) {
      updateQR("connected", socket, userRecord);
    } else if (qrDinamic) {
      updateQR("qr", socket, userRecord);
    }
  });

  // Manejo de desconexiones
  socket.on("disconnect", () => {
    console.log(`Cliente desconectado con id_externo: ${socket.id_externo}`);
  });
});

const updateQR = async (data, userRecord) => {
  switch (data) {
    case "qr":
      qrcode.toDataURL(qrDinamic, async (err, url) => {
        if (soket?.id_externo) {
          soket.emit("qr", url);
          soket.emit("log", "QR recibido, escanea");
        } else {
          console.error("id_externo no está definido en el socket");
        }

        if (userRecord) {
          userRecord.qr = url; // QR en base 64

          await whatsapp_registros.updateOne(
            { id_externo: userRecord.id_externo },
            { $set: { qr: url } }
          );
        }
      });
      break;
    case "connected":
      if (userRecord) {
        const user = await getUserRecordByIdExterno(userRecord.id_externo);

        const { id_externo, nombre } = user;

        soket?.emit("qrstatus", "/assets/check.svg");
        soket?.emit("log", "Usuario conectado");

        const userinfo = `${id_externo} ${nombre}`;
        soket?.emit("user", userinfo);
      }
      break;
    case "loading":
      if (userRecord) {
        userRecord.estado = "cargando";

        await collection.updateOne(
          { _id: userRecord._id },
          { $set: { estado: userRecord.estado } }
        );
      }

      soket?.emit("qrstatus", "/assets/loader.gif");
      soket?.emit("log", "Cargando ....");
      break;
    default:
      break;
  }
};

/* Metodos para realizar acciones en mongo */
async function updateUserRecord(id_externo, updatedFields) {
  return await whatsapp_registros.updateOne(
    { id_externo: id_externo },
    { $set: updatedFields }
  );
}

async function getUserRecordByIdExterno(id_externo) {
  return await whatsapp_registros.findOne({ id_externo });
}

async function getUserRecords() {
  return await whatsapp_registros.find().toArray();
}

const startServer = async () => {
  try {
    db = await connectToMongoDB();
    whatsapp_registros = db.collection("registros_whatsapp");

    const registros = await getUserRecords();

    if (!registros || registros.length === 0) {
      console.log("No hay registros aun.");
    } else {
      for (const registro of registros) {
        const id_externo = registro.id_externo;
        const receiveMessages = registro.receive_messages;

        await connectToWhatsApp(id_externo, receiveMessages).catch((err) => {
          console.log(`Error inesperado para id_externo ${id_externo}: ${err}`);
        });
      }
    }

    server.listen(port, () => {
      console.log("Server Run Port : " + port);
    });
  } catch (error) {
    console.error("Error al iniciar el servidor:", error);
  }
};

startServer();
