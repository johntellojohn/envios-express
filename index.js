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

const dotenv = require("dotenv");
dotenv.config();

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

/* Importaciones para registrar clientes */
const { createFunction } = require("./functions/functions");
const connectToMongoDB = require("./functions/connect-mongodb");
const mongoAuthState = require("./mongoAuthState");

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
  const { nombre, id_externo, descripcion } = req.body;

  try {
    const registroExistente = await getUserRecordByIdExterno(id_externo);

    if (!registroExistente) {
      if (nombre && id_externo) {
        const registros = db.collection("registros_whatsapp");
        const nuevoRegistro = {
          nombre,
          id_externo,
          descripcion,
          fechaCreacion: new Date(),
        };

        const insertResult = await registros.insertOne(nuevoRegistro);

        const sessionId = await connectToWhatsApp(id_externo);
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
          error: "Por favor, proporciona un nombre y un ID",
        });
      }
    } else {
      res.status(400).send({
        result: false,
        error: "Ya existe un registro con el mismo ID",
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

/* Endpoint para activar el envio de mensajes para el usuario creado */
app.post("/activar-usuario", async (req, res) => {
  const { id_externo } = req.body;

  if (id_externo) {
    try {
      const filePath = path.join(
        __dirname,
        `functions/clientes_whatsapp/${id_externo}.js`
      );

      const createdFunction = require(filePath);

      const connected = await isConnected(id_externo);
      const sockUser = WhatsAppSessions[id_externo]?.sock;

      if (!sockUser) {
        return res.status(404).send({
          result: false,
          success: "",
          error: `No se encontró sock para el usuario con id_externo: ${id_externo}.`,
        });
      }

      // Envia la informacion correspondiente del usuario para mensajes
      const result = await createdFunction(app, connected, sockUser, db);

      res.send({ result });
    } catch (error) {
      console.error("Error al ejecutar la función:", error);
      res.status(500).send({
        result: false,
        success: "",
        error: "Error al ejecutar la función",
      });
    }
  } else {
    const sms = "Por favor, proporciona el id y un parámetro";
    console.log(sms);
    res.status(400).send({
      result: false,
      success: "",
      error: sms,
    });
  }
});

/* Endpoint para realizar el envio de mensajes */
app.post("/send-message/:id_externo", async (req, res) => {
  const { id_externo } = req.params;
  const { number, tempMessage } = req.body;

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
        // Verificamos el estado del sock
        const estadoSock =
          WhatsAppSessions[id_externo]?.sock?.ws?.socket?._readyState;

        if (estadoSock !== 1) {
          console.log("Implementando reconexión...");
          await connectToWhatsApp(id_externo); // Llamar a la función de reconexión
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
            console.log({
              De: "cliente-" + id_externo,
              Para: numberWA,
              Message: tempMessage,
              Fecha: Date(),
            });
            return res.status(200).json({
              status: true,
              response: result,
            });
          } catch (err) {
            return res.status(500).json({
              status: false,
              response: err,
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

    if (WhatsAppSessions[id_externo]) {
      if (WhatsAppSessions[id_externo].sock) {
        try {
          // Verifica si el socket sigue conectado
          if (WhatsAppSessions[id_externo].sock?.socket?._readyState === 1) {
            // await WhatsAppSessions[id_externo].sock.logout();
            await WhatsAppSessions[id_externo].sock.ws.close();
            console.log(`Conexión cerrada para el ID ${id_externo}`);
          }
        } catch (error) {
          console.error(
            `Error al intentar cerrar la sesión para ${id_externo}:`,
            error
          );
        }
        delete WhatsAppSessions[id_externo];
      }
    }

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

    // Verifica si la colección existe
    const collections = await db
      .listCollections({ name: sessionName })
      .toArray();

    if (collections.length > 0) {
      await db.collection(sessionName).drop();
      console.log(`Colección ${sessionName} eliminada correctamente.`);
    } else {
      console.log(`La colección ${sessionName} no existe.`);
    }
  } catch (error) {
    console.error(
      `Error al eliminar registro con id_externo ${id_externo}:`,
      error
    );
  }
}

async function connectToWhatsApp(id_externo) {
  const sessionCollection = `session_auth_info_${id_externo}`;
  const collection_session = db.collection(sessionCollection);

  const { state, saveCreds } = await mongoAuthState(collection_session);

  const sock = makeWASocket({
    printQRInTerminal: false,
    auth: state,
    logger: log({ level: "silent" }),
    qrTimeout: 60 * 1000,
  });

  sock.ev.on("connection.update", async (update) => {
    try {
      const { connection, lastDisconnect, qr } = update;
      let previousQR = update.qr;

      const userRecord = await getUserRecordByIdExterno(id_externo);

      if (userRecord) {
        if (userRecord.sock?.qr !== undefined && userRecord.sock?.qr !== null) {
          previousQR = userRecord.sock?.qr;
        }

        await updateUserRecord(id_externo, {
          sock: {
            connection: connection || null,
            lastDisconnect: lastDisconnect || null,
            qr: qr || previousQR || null,
          },
        });
      }

      if (qr) {
        console.log(`QR generado para el usuario: ${id_externo}`);
      }

      if (connection === "connecting") return;

      if (connection === "close") {
        console.log("Conexión cerrada detectada");
        // const reason = new Boom(lastDisconnect?.error).output?.statusCode;
        const reason = lastDisconnect?.error?.output?.statusCode;

        if (reason !== DisconnectReason.loggedOut) {
          await connectToWhatsApp(id_externo);
        } else if (reason === DisconnectReason.loggedOut) {
          console.log(
            `Dispositivo cerrado. Elimine ${session} y escanee nuevamente.`
          );
          await removeRegistro(id_externo);
        }
      } else if (connection === "open") {
        console.log(`conexión abierta para el id: ${id_externo}`);

        try {
          const userRecord = await getUserRecordByIdExterno(id_externo);
          if (userRecord) {
            await updateUserRecord(id_externo, { estado: "conectado" });
          }
        } catch (error) {
          console.error(
            `Error actualizando estado de conexión para ${id_externo}:`,
            error
          );
        }

        if (WhatsAppSessions[id_externo]) {
          console.log(
            `Reemplazando el socket existente para el id: ${id_externo}`
          );
          WhatsAppSessions[id_externo].sock.end(); // Cierra el socket anterior
        }

        WhatsAppSessions[id_externo] = {
          sock: sock,
        };

        return;
      }
    } catch (error) {
      console.error(`Error en connection.update para ${id_externo}:`, error);
    }
  });

  //Recibir mensajes revisados y responder
  // sock.ev.on("messages.upsert", async ({ messages, type }) => {
  //   try {
  //     if (type === "notify") {
  //       if (!messages[0]?.key.fromMe) {
  //         const captureMessage = messages[0]?.message?.conversation;
  //         const numberWa = messages[0]?.key?.remoteJid;

  //         //extrar numero
  //         const regexNumber = /(\d+)/;
  //         const matchNumber = numberWa.match(regexNumber);
  //         if (matchNumber) {
  //           phoneNumber = matchNumber[1];
  //         } else {
  //           phoneNumber = "";
  //         }

  //         //Verificar si es usuario o grupo
  //         const regex = /^.*@([sg]).*$/;
  //         const match = numberWa.match(regex);
  //         let cliente = false;
  //         if (match) {
  //           switch (match[1]) {
  //             case "s":
  //               cliente = true;
  //               break;
  //             case "g":
  //               cliente = false;
  //               break;
  //             default:
  //               cliente = false;
  //               break;
  //           }
  //         } else {
  //           cliente = false;
  //         }

  //         //Solo numero de Deyssi envios desde mi pc
  //         const fetch = require("node-fetch");
  //         // if (cliente && phoneNumber !== '' && phoneNumber == "593981773526") {
  //         if (cliente && phoneNumber !== "") {
  //           // Preparar los datos a enviar al webhook
  //           const data = JSON.stringify({
  //             empresa: "sigcrm_clinicasancho",
  //             name: phoneNumber,
  //             description: captureMessage,
  //           });

  //           const options = {
  //             hostname: "sigcrm.pro",
  //             path: "/response-baileys",
  //             method: "POST",
  //             headers: {
  //               "Content-Type": "application/json",
  //               "Content-Length": data.length,
  //             },
  //           };

  //           const req = https.request(options, (res) => {
  //             let responseData = "";

  //             res.on("data", (chunk) => {
  //               responseData += chunk;
  //             });

  //             res.on("end", () => {
  //               // console.log("Response:", responseData);
  //             });
  //           });

  //           req.on("error", (error) => {
  //             console.error("Error:", error);
  //           });

  //           // Escribe los datos al cuerpo de la solicitud
  //           req.write(data);
  //           req.end();

  //           // await sock.sendMessage(
  //           //   numberWa,
  //           //   {
  //           //     text: "whatsapp on",
  //           //   },
  //           //   {
  //           //     quoted: messages[0],
  //           //   }
  //           // );
  //         }
  //       }
  //     }
  //   } catch (error) {
  //     console.log("error ", error);
  //   }
  // });

  sock.ev.on("creds.update", saveCreds);
}

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

      const sockUser = WhatsAppSessions[id_externo]?.sock;

      if (isConnected()) {
        const exist = await sockUser.onWhatsApp(numberWA);

        if (exist?.jid || (exist && exist[0]?.jid)) {
          switch (type) {
            case "image":
              sockUser
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
              sockUser
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
              sockUser
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
              sockUser
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
            default:
              sockUser
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

        await connectToWhatsApp(id_externo).catch((err) => {
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
