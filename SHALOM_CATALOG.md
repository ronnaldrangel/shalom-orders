# 📦 Catálogo de Productos y Destinos - Shalom Pro

Este documento contiene la lista detallada de códigos de productos y ejemplos de destinos válidos para utilizar con la API de Shalom Multitenant.

---

## 📦 1. Tipos de Productos Disponibles

Para el campo `productType` en el registro de envíos, utiliza los siguientes códigos:

| Código | Nombre en Shalom | Descripción / Dimensiones | Capacidad Máxima |
| :--- | :--- | :--- | :--- |
| `sobre` | Sobre | Documentos simples en sobre manila / Tamaño A4 | N/A |
| `xxs` | Caja Paquete XXS | 15 x 10 x 10 cm | Hasta 250 gr |
| `xs` | Caja Paquete XS | 15 x 20 x 12 cm | Hasta 500 gr |
| `s` | Caja Paquete S | 20 x 30 x 12 cm | Hasta 2 kg |
| `m` | Caja Paquete M | 24 x 30 x 20 cm | Hasta 5 kg |
| `l` | Caja Paquete L | 42 x 30 x 23 cm | Hasta 10 kg |
| `custom` | Otra Medida | Dimensiones y peso personalizados | Según lo ingresado |

---

## 📍 2. Formato de Ubicaciones y Destinos

El buscador de Shalom Pro utiliza el siguiente formato jerárquico:  
`DEPARTAMENTO / PROVINCIA / DISTRITO / AGENCIA`

### 💡 Tips para la búsqueda vía API:
- Puedes enviar el texto completo (ej: `LIMA / LIMA / ATE-VITARTE / URB SANTA ELVIRA`).
- Puedes enviar una búsqueda parcial (ej: `AREQUIPA AV PARRA`) y el sistema seleccionará la primera coincidencia.

### 🏢 Catálogo de Agencias Frecuentes

#### Lima / Callao:
- `LIMA / LIMA / ATE-VITARTE / URB SANTA ELVIRA`
- `LIMA / LIMA / COMAS / AV. TRAPICHE`
- `LIMA / LIMA / SAN JUAN DE LURIGANCHO / JR CHINCHAYSUYO CDRA 4`
- `LIMA / LIMA / CARABAYLLO / TUNGASUCA`
- `LIMA / LIMA / LOS OLIVOS / AV ALFREDO MENDIOLA`
- `LIMA / LIMA / LA VICTORIA / AV MEXICO`
- `LIMA / BARRANCA / BARRANCA / BARRANCA`
- `LIMA / HUAURA / HUACHO / SALAVERRY HUACHO CO`

#### Norte:
- `LA LIBERTAD / TRUJILLO / LA ESPERANZA / WICHANZAO`
- `PIURA / PIURA / PIURA / PIURA CO`
- `LAMBAYEQUE / CHICLAYO / CHICLAYO / CHICLAYO CO`
- `CAJAMARCA / CAJAMARCA / CAJAMARCA / CAJAMARCA CO`
- `TUMBES / ZARUMILLA / ZARUMILLA / ZARUMILLA`

#### Sur:
- `AREQUIPA / AREQUIPA / AREQUIPA / AV PARRA 379 CO`
- `AREQUIPA / AREQUIPA / CERRO COLORADO / ZAMACOLA`
- `CUSCO / CUSCO / SANTIAGO / URB. BANCOPATA AV. INDUSTRIAL`
- `CUSCO / URUBAMBA / URUBAMBA / CUSCO URUBAMBA`
- `PUNO / PUNO / PUNO / PUNO CO`
- `ICA / ICA / ICA / ICA SAN JOAQUIN`
- `MOQUEGUA / ILO / ILO / ILO CO PAMPA INALAMBRICA`

#### Centro y Selva:
- `JUNIN / HUANCAYO / HUANCAYO / HUANCAYO CO`
- `AYACUCHO / HUAMANGA / AYACUCHO / AYACUCHO CO`
- `SAN MARTIN / MOYOBAMBA / MOYOBAMBA / OVALO ORQUIDEAS CO`
- `UCAYALI / CORONEL PORTILLO / PUCALLPA YARINACOCHA`
- `PASCO / PASCO / CHAUPIMARCA / CERRO DE PASCO`

---

## ✈️ 3. Servicios Especiales

### Destinos Aéreos
Muchos destinos cuentan con soporte para envío aéreo. Para utilizarlos, asegúrate de que el texto de búsqueda incluya `- AEREO`.
- Ejemplo: `AREQUIPA / AREQUIPA / AREQUIPA / AV PARRA 379 CO - AEREO`

---
*Última actualización: 24 de Enero de 2026*
