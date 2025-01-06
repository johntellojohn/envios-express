const fs = require("fs");
const path = require("path");
const template = require("../template/template.js");

const activeFunctions = new Map();

const createFunction = (name) => {
  saveFunction(name);
  return name;
};

const removeFunction = async (name) => {
  const func = activeFunctions.get(name);
  if (func && func.stopFunction) {
    func.stopFunction(); // Llama a la función de detención
  }

  const jsFilePath = path.join(__dirname, "clientes_whatsapp", `${name}.js`);
  try {
    await fs.promises.unlink(jsFilePath);
    console.log(`Archivo ${name}.js eliminado con éxito.`);
  } catch (error) {
    console.error(`Error al eliminar el archivo ${name}.js:`, error);
  }

  activeFunctions.delete(name); // Eliminar la función del mapa
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

module.exports = { createFunction, removeFunction };
