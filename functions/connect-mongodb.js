const { MongoClient } = require("mongodb");

const config = require("../config.js");

// Conectar a MongoDB
const connectToMongoDB = async () => {
  try {
    const mongoClient = new MongoClient(config.mongoose.url, {
      //   useNewUrlParser: true,
      //   useUnifiedTopology: true,
    });
    
    await mongoClient.connect();
    console.log("Conectado a MongoDB correctamente");

    const db = mongoClient.db("ariana_crm");

    return db;
  } catch (error) {
    console.error("Error al conectar a MongoDB:", error);
  }
};

module.exports = connectToMongoDB;
