const template = (id) => {
  return `const express = require("express");

const main = async (app, connected, sock, db) => {
  try {
    // Endpoint para enviar mensajes de WhatsApp
    app.post('/send-message${id}', async (req, res) => {
      const { number, tempMessage } = req.body;
      let numberWA;

      try {
        const registros = db.collection("registros_whatsapp");
        const registro = await registros.findOne({ id_externo: "${id}" });

        console.log("Paso las consultas del mongo");

        if (!registro) {
          console.log(\`---------------------------------- Registro no encontrado ${id} ----------------------------------\`);
          res.status(404).json({ error: 'Registro no encontrado' });
          return;
        }

        if (!number || !tempMessage) {
          res.status(400).json({
            status: false,
            response: "Número o mensaje no proporcionado",
          });
        } else {
          numberWA = number + "@s.whatsapp.net";

          console.log("Paso la validacion del registro");

          if (connected) {
            const exist = await sock.onWhatsApp(numberWA);

            if (!exist) {
              return res.status(500).json({
                status: false,
                response: "No se pudo realizar la consulta, conexión cerrada.",
              });
            }

            console.log("Paso la validacion del exist");

            if (exist?.jid || (exist && exist[0]?.jid)) {
              sock
                .sendMessage(exist.jid || exist[0].jid, {
                  text: tempMessage,
                })
                .then((result) => {
                  console.log({
                    De: "cliente-${id}",
                    Para: numberWA,
                    Message: tempMessage,
                    Fecha: Date(),
                  });
                  res.status(200).json({
                    status: true,
                    response: result,
                  });
                })
                .catch((err) => {
                  console.error({
                    De: "cliente-${id}",
                    Para: numberWA,
                    Message: "*-*-*-*-*-* Mensaje no enviado *-*-*-*-*-*",
                    Fecha: Date(),
                  });
                  res.status(500).json({
                    status: false,
                    response: err,
                  });
                });
            } else {
              res.status(404).json({
                status: false,
                response: "Número no encontrado en WhatsApp",
              });
            }
          } else {
            res.status(500).json({
              status: false,
              response: "No estás conectado a WhatsApp",
            });
          }
        }
      } catch (error) {
        console.error("cliente-${id} : Error desconocido:", error);
        res.status(500).json({ result: false, errorsms: error.message });
      }
    });

    // Endpoint para mensajería masiva
    // app.post("/mass-messaging${id}", async (req, res) => {
    //   try {
    //     const registros = await getRegistros();
    //     const registro = registros.find((r) => r.id_externo === "${id}");
    //     if (!registro) {
    //       console.log(
    //         "---------------------------------- Registro no encontrado ${id} ----------------------------------"
    //       );
    //       res.status(404).json({ error: "Registro no encontrado" });
    //       return;
    //     }

    //     const { messages } = req.body; // Recibe un array de mensajes
    //     if (!messages || !Array.isArray(messages) || messages.length === 0) {
    //       res.status(400).json({
    //         result: false,
    //         error: "Falta el array de mensajes en el cuerpo de la solicitud",
    //       });
    //       return;
    //     }

    //     let resultados = [];

    //     for (const { phone, message, tipo } of messages) {
    //       if (phone && message && tipo) {
    //         let chatId = phone.length > 12 ? \`\${phone}@g.us\` : \`\${phone}@c.us\`;

    //         try {
    //           // Añadir el trabajo de mensajes masivos a la cola
    //           await sendQueue.add({ chatId, message, tipo });
    //           console.log({
    //             De: "cliente-${id}",
    //             Para: chatId,
    //             Message: message,
    //             Fecha: Date(),
    //           });
    //           resultados.push({
    //             phone,
    //             result: true,
    //             success: "Message added to queue",
    //           });

    //         } catch (error) {
    //           console.log({
    //             De: "cliente-${id}",
    //             Para: chatId,
    //             Message: "*-*-*-*-*-* Mensaje no enviado *-*-*-*-*-*",
    //             Fecha: Date(),
    //           });
    //           resultados.push({
    //             phone,
    //             result: false,
    //             error: "Error adding message to queue: " + error.message,
    //           });
    //         }
    //       } else {
    //         console.log(\`--------- cliente-${id} : Falta algún parámetro para el teléfono \${phone} ---------\`);
    //         resultados.push({
    //           phone,
    //           result: false,
    //           error: "Falta algún parámetro en su archivo json",
    //         });
    //       }
    //     }

    //     res.json({ result: true, results: resultados });
    //   } catch (error) {
    //     console.log("cliente-${id} : Error desconocido");
    //     console.log(error.message);
    //     res.status(500).json({ result: false, error: error.message });
    //   }
    // });

    // // Endpoint para obtener información del usuario
    // app.post("/user${id}", async (req, res) => {
    //   try {
    //     const userId = adapterProvider.vendor.user.id;
    //     const userName = adapterProvider.vendor.user.name;
    //     console.log(
    //       "--------- INFORMACION DEL cliente-${id} ENTREGADA ---------"
    //     );
    //     res.json({ result: true, userId, userName });
    //   } catch (error) {
    //     console.log("cliente-${id} : Error desconocido");
    //     console.log(error.message);
    //     res.status(500).json({ result: false, errorsms: error.message });
    //   }
    // });

    return {
      result: true,
      success: "Envío de mensajes configurado correctamente",
      error: "",
    };
  } catch (error) {
    console.error("Error al inicializar la función:", error);
    return {
      result: false,
      success: "",
      error: "Error al ejecutar la función: " + error.message,
    };
  }
};

// Función para verificar si estás conectado a WhatsApp
const isConnected = (sock) => {
  return sock?.user ? true : false;
};

module.exports = main;
`;
};

module.exports = template;
