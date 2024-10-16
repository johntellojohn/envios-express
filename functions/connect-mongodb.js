const { MongoClient } = require("mongodb");

const config = require("../config.js");

// Conectar a MongoDB
const connectToMongoDB = async () => {
  try {
    const mongoClient = new MongoClient(config.mongoose.url, {
      //   useNewUrlParser: true,
      //   useUnifiedTopology: true,
    });

    // Conectar a la base de datos
    await mongoClient.connect();
    console.log("Conectado a MongoDB correctamente");

    // Seleccionar la base de datos
    const db = mongoClient.db("registros_whatsapp");

    // Aquí puedes interactuar con tus colecciones, por ejemplo:
    return db;
  } catch (error) {
    console.error("Error al conectar a MongoDB:", error);
  }
};

module.exports = connectToMongoDB;
