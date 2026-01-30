const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

/**
 * Generates an Excel file for massive shipment registration with specific columns.
 * 
 * Columns:
 * DESTINATARIO (DOC) | TELF. DESTINATARIO | CONTACTO (DOC) | TELF. CONTACTO | NRO GRR | ORIGEN | DESTINO | MERCADERIA | ALTO | ANCHO | LARGO | PESO | CANTIDAD
 * 
 * @param {Array} shipments - Array of shipment objects
 * @param {string} outputDir - Directory to save the file (default: ./temp)
 * @returns {string} - Absolute path to the generated file
 */
function generateMassiveShipmentExcel(shipments, outputDir = './temp') {
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Map shipments to rows
  const rows = shipments.map(s => ({
    'DESTINATARIO (DOC)': s.recipientDoc || s.recipient?.documentNumber || '',
    'TELF. DESTINATARIO': s.recipientPhone || s.recipient?.phone || '',
    'CONTACTO (DOC)': s.contactDoc || s.recipientDoc || s.recipient?.documentNumber || '',
    'TELF. CONTACTO': s.contactPhone || s.recipientPhone || s.recipient?.phone || '',
    'NRO GRR': s.grr || '',
    'ORIGEN': s.origin || '',
    'DESTINO': s.destination || '',
    'MERCADERIA': s.content || s.merchandise || '',
    'ALTO': s.height || s.alto || 0,
    'ANCHO': s.width || s.ancho || 0,
    'LARGO': s.length || s.largo || 0,
    'PESO': s.weight || s.peso || 0,
    'CANTIDAD': s.quantity || s.cantidad || 1
  }));

  // Create worksheet
  const worksheet = XLSX.utils.json_to_sheet(rows);

  // Create workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Envíos');

  // Generate filename
  const filename = `envios_masivos_${Date.now()}.xlsx`;
  const filePath = path.resolve(outputDir, filename);

  // Write file
  XLSX.writeFile(workbook, filePath);

  return filePath;
}

module.exports = { generateMassiveShipmentExcel };
