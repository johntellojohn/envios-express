const { MongoClient } = require("mongodb");

const mongoUSER = "whatsapp_api";
const mongoPASSWD = "8EHKR2jDbsz3x8n0";
const mongoDB = "whatsapp_api";
const mongoURI = `mongodb+srv://${mongoUSER}:${mongoPASSWD}@cluster0.ft3wt.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Conectar a MongoDB
const connectToMongoDB = async () => {
  try {
    // Inicializar el cliente de MongoDB
    const mongoClient = new MongoClient(mongoURI, {
      //   useNewUrlParser: true,
      //   useUnifiedTopology: true,
    });

    // Conectar a la base de datos
    await mongoClient.connect();
    console.log("Conectado a MongoDB correctamente");

    // Seleccionar la base de datos
    const db = mongoClient.db(mongoDB);

    // Aquí puedes interactuar con tus colecciones, por ejemplo:
    return db;
  } catch (error) {
    console.error("Error al conectar a MongoDB:", error);
  }
};

module.exports = connectToMongoDB;
