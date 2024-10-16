// URL of the Mongo DB
const MONGODB_URL =
  process.env.MONGODB_URL || "mongodb://127.0.0.1:27017/WhatsAppInstance";

module.exports = {
  mongoose: {
    url: MONGODB_URL,
    options: {
      // useCreateIndex: true,
      useNewUrlParser: true,
      useUnifiedTopology: true,
    },
  },
};
