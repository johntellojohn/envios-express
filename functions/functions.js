const fs = require("fs");
const path = require("path");
const template = require("../template/template.js");

const createFunction = (name) => {
  saveFunction(name);
  return name;
};

const saveFunction = (name) => {
  const dirPath = path.join(__dirname, "clientes_whatsapp");

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true }); // Crear la carpeta
  }

  const filePath = path.join(dirPath, `${name}.js`); // Ruta completa del archivo
  const content = template(name); // Generar el contenido del archivo usando el template
  fs.writeFileSync(filePath, content, "utf8");
};

module.exports = { createFunction };
