# 📚 Shalom Multitenant API Documentation

> **API de automatización para gestión de sesiones en Shalom Pro**  
> Versión: 1.0.0 | Puerto por defecto: 3000

---

## 📋 Tabla de Contenidos

- [Descripción General](#-descripción-general)
- [Arquitectura](#-arquitectura)
- [Autenticación](#-autenticación)
- [Endpoints](#-endpoints)
  - [Crear Instancia](#1-crear-instancia)
  - [Listar Instancias](#2-listar-instancias)
  - [Obtener Estado](#3-obtener-estado)
  - [Iniciar Sesión](#4-iniciar-sesión-login)
  - [Cerrar Sesión](#5-cerrar-sesión-logout)
  - [Eliminar Instancia](#6-eliminar-instancia)
  - [Registrar Envío](#7-registrar-envío-shipment)
- [Catálogo de Destinos y Productos](#-catálogo-de-destinos-y-productos)
- [Códigos de Estado HTTP](#-códigos-de-estado-http)
- [Ejemplos de Uso](#-ejemplos-de-uso)
- [Tecnologías Utilizadas](#-tecnologías-utilizadas)

---

## 🎯 Descripción General

Esta API permite gestionar múltiples instancias de navegador (tenants) para automatizar el inicio de sesión y la gestión de sesiones en la plataforma **Shalom Pro** (`https://pro.shalom.pe`).

### Características principales:
- ✅ Gestión multitenant (múltiples instancias simultáneas)
- ✅ Automatización de login con reintentos configurables
- ✅ Cada instancia tiene su propia API Key única
- ✅ Control completo del ciclo de vida de las sesiones

---

## 🏗 Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                      Cliente (Frontend)                      │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP Requests
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Fastify Server (API)                      │
│                     Puerto: 3000                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     TenantManager                            │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐              │
│  │ Instance 1 │ │ Instance 2 │ │ Instance N │   ...        │
│  │  Browser   │ │  Browser   │ │  Browser   │              │
│  │  + Page    │ │  + Page    │ │  + Page    │              │
│  └────────────┘ └────────────┘ └────────────┘              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔐 Autenticación

La mayoría de los endpoints requieren autenticación mediante **API Key**.

### Header requerido:
```
x-api-key: <tu-api-key>
```

> ⚠️ La API Key se genera automáticamente al crear una instancia y es única para cada una.

### Admin API Key

Existe una **Admin API Key** configurada en el archivo `.env` que permite acceso a **cualquier instancia** sin necesidad de usar la API Key específica de esa instancia.

```env
ADMIN_API_KEY=admin-shalom-secret-key-2026
```

Cuando usas la Admin API Key:
- Solo necesitas el header `x-api-key` con la Admin API Key
- Debes enviar el `instanceId` en el body para indicar qué instancia quieres controlar
- Puedes controlar cualquier instancia activa

### Endpoints públicos (sin autenticación):
- `POST /instances` - Crear instancia
- `GET /instances` - Listar instancias

### Endpoints protegidos (requieren API Key o Admin API Key):
- `POST /status` - Obtener estado
- `POST /login` - Iniciar sesión
- `POST /logout` - Cerrar sesión
- `DELETE /instances` - Eliminar instancia

---

## 📡 Endpoints

### 1. Crear Instancia

Crea una nueva instancia de navegador y navega a la página de login de Shalom Pro.

```http
POST /instances
```

#### Request
No requiere body ni headers especiales.

#### Response (200 OK)
```json
{
  "status": "created",
  "apiKey": "550e8400-e29b-41d4-a716-446655440000",
  "instanceId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "message": "Instance created and browser opened"
}
```

#### Response (500 Error)
```json
{
  "error": "Failed to create instance"
}
```

---

### 2. Listar Instancias

Devuelve todas las instancias activas (útil para debugging/administración).

```http
GET /instances
```

#### Request
No requiere body ni headers especiales.

#### Response (200 OK)
```json
{
  "instances": [
    {
      "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "apiKey": "550e8400-e29b-41d4-a716-446655440000",
      "createdAt": "2026-01-24T19:30:00.000Z"
    },
    {
      "id": "8d0f7780-8536-51ef-b55c-f18fd2a01bf8",
      "apiKey": "661f9511-f3ac-52e5-b827-557766551111",
      "createdAt": "2026-01-24T19:35:00.000Z"
    }
  ]
}
```

---

### 3. Obtener Estado

Verifica el estado de autenticación de una instancia.

```http
POST /status
```

#### Headers
| Header      | Tipo   | Requerido | Descripción              |
|-------------|--------|-----------|--------------------------|
| x-api-key   | string | ✅        | API Key de la instancia  |

#### Body (JSON)
| Campo      | Tipo   | Requerido | Descripción                        |
|------------|--------|-----------|------------------------------------|
| instanceId | string | ✅        | ID de la instancia                 |

#### Ejemplo de Request
```json
{
  "instanceId": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```

#### Response (200 OK) - Usuario autenticado
```json
{
  "isLoggedIn": true,
  "username": "usuario@ejemplo.com",
  "url": "https://pro.shalom.pe/dashboard"
}
```

#### Response (200 OK) - Usuario no autenticado
```json
{
  "isLoggedIn": false,
  "username": null,
  "url": "https://pro.shalom.pe/login"
}
```

#### Response (401 Unauthorized)
```json
{
  "error": "Missing x-api-key header"
}
```

#### Response (403 Forbidden)
```json
{
  "error": "Invalid API Key or Instance not active"
}
```

---

### 4. Iniciar Sesión (Login)

Realiza el inicio de sesión automático en Shalom Pro.

```http
POST /login
```

#### Headers
| Header      | Tipo   | Requerido | Descripción              |
|-------------|--------|-----------|--------------------------|
| x-api-key   | string | ✅        | API Key de la instancia  |

#### Body (JSON)
| Campo      | Tipo   | Requerido | Default | Descripción                           |
|------------|--------|-----------|---------|---------------------------------------|
| instanceId | string | ✅        | -       | ID de la instancia                    |
| username   | string | ✅        | -       | Usuario/Email para iniciar sesión     |
| password   | string | ✅        | -       | Contraseña del usuario                |
| retries    | number | ❌        | 3       | Número de reintentos en caso de fallo |

#### Ejemplo de Request
```json
{
  "instanceId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "username": "usuario@ejemplo.com",
  "password": "miContraseña123",
  "retries": 5
}
```

#### Response (200 OK) - Login exitoso
```json
{
  "success": true,
  "message": "Login successful",
  "url": "https://pro.shalom.pe/dashboard"
}
```

#### Response (200 OK) - Ya autenticado
```json
{
  "success": true,
  "message": "Already logged in",
  "url": "https://pro.shalom.pe/dashboard"
}
```

#### Response (400 Bad Request)
```json
{
  "error": "Username and password are required"
}
```

#### Response (401 Unauthorized) - Credenciales inválidas
```json
{
  "success": false,
  "message": "Login failed: Invalid credentials or timeout"
}
```

#### Response (500 Error)
```json
{
  "error": "Login execution failed",
  "details": "Mensaje de error detallado"
}
```

---

### 5. Cerrar Sesión (Logout)

Cierra la sesión actual y limpia cookies/almacenamiento.

```http
POST /logout
```

#### Headers
| Header      | Tipo   | Requerido | Descripción              |
|-------------|--------|-----------|--------------------------|
| x-api-key   | string | ✅        | API Key de la instancia  |

#### Body (JSON)
| Campo      | Tipo   | Requerido | Descripción                        |
|------------|--------|-----------|------------------------------------|
| instanceId | string | ✅        | ID de la instancia                 |

#### Ejemplo de Request
```json
{
  "instanceId": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```

#### Response (200 OK)
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

#### Response (500 Error)
```json
{
  "error": "Logout failed",
  "details": "Mensaje de error detallado"
}
```

---

### 6. Eliminar Instancia

Cierra el navegador y elimina la instancia del sistema.

```http
DELETE /instances
```

#### Headers
| Header      | Tipo   | Requerido | Descripción              |
|-------------|--------|-----------|--------------------------|
| x-api-key   | string | ✅        | API Key de la instancia  |

#### Body (JSON)
| Campo      | Tipo   | Requerido | Descripción                        |
|------------|--------|-----------|-----------------------------------|
| instanceId | string | ✅        | ID de la instancia                 |

#### Ejemplo de Request
```json
{
  "instanceId": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```

#### Response (200 OK)
```json
{
  "status": "closed",
  "message": "Instance closed successfully"
}
```

#### Response (500 Error)
```json
{
  "error": "Failed to close instance"
}
```

---

### 7. Registrar Envío (Shipment)

Registra un nuevo envío en Shalom Pro de forma automatizada.

```http
POST /shipments
```

#### Headers
| Header      | Tipo   | Requerido | Descripción              |
|-------------|--------|-----------|--------------------------|
| x-api-key   | string | ✅        | API Key de la instancia  |

#### Body (JSON)
| Campo                       | Tipo    | Requerido | Default | Descripción                                    |
|-----------------------------|---------|-----------|---------|------------------------------------------------|
| productType                 | string  | ✅        | -       | Tipo de producto: `sobre`, `xxs`, `xs`, `s`, `m`, `l`, `custom` |
| origin                      | string  | ✅        | -       | Texto de búsqueda para la ubicación de origen  |
| destination                 | string  | ✅        | -       | Texto de búsqueda para la ubicación de destino |
| recipient                   | object  | ✅        | -       | Datos del destinatario                         |
| recipient.documentType      | string  | ❌        | `dni`   | Tipo de documento: `dni`, `ruc`, `ce`          |
| recipient.documentNumber    | string  | ✅        | -       | Número de documento del destinatario           |
| recipient.phone             | string  | ❌        | -       | Teléfono (opcional, usa el autocompletado)     |
| warranty                    | boolean | ❌        | `false` | Si desea añadir garantía                       |
| secureBilling               | boolean | ❌        | `false` | Si desea servicio de cobro seguro              |
| securityCode                | string  | ❌        | `5858`  | Clave de 4 dígitos (no consecutivos)           |
| documentation               | object  | ❌        | -       | Documentación opcional (guía de remisión)      |
| documentation.serie         | string  | ❌        | -       | Serie del documento                            |
| documentation.number        | string  | ❌        | -       | Número del documento                           |
| customDimensions            | object  | ❌        | -       | Dimensiones personalizadas (solo si productType es `custom`) |
| customDimensions.largo      | number  | ❌        | -       | Largo en cm                                    |
| customDimensions.ancho      | number  | ❌        | -       | Ancho en cm                                    |
| customDimensions.alto       | number  | ❌        | -       | Alto en cm                                     |
| customDimensions.peso       | number  | ❌        | -       | Peso en kg                                     |

#### Tipos de Producto Disponibles

| Código  | Nombre           | Peso Máximo | Dimensiones (cm)   |
|---------|------------------|-------------|--------------------|
| `sobre` | Sobre            | -           | Documentos A4      |
| `xxs`   | Caja Paquete XXS | 250 gr      | 15 x 10 x 10       |
| `xs`    | Caja Paquete XS  | 500 gr      | 15 x 20 x 12       |
| `s`     | Caja Paquete S   | 2 kg        | 20 x 30 x 12       |
| `m`     | Caja Paquete M   | 5 kg        | 24 x 30 x 20       |
| `l`     | Caja Paquete L   | 10 kg       | 42 x 30 x 23       |
| `custom`| Otra Medida      | Variable    | Personalizado      |

#### Ejemplo de Request Básico
```json
{
  "productType": "sobre",
  "origin": "LIMA ATE",
  "destination": "AREQUIPA",
  "recipient": {
    "documentType": "dni",
    "documentNumber": "87654321"
  },
  "securityCode": "5858"
}
```

#### Ejemplo de Request Completo
```json
{
  "productType": "s",
  "origin": "LIMA SANTA ELVIRA",
  "destination": "AREQUIPA CHALA",
  "recipient": {
    "documentType": "dni",
    "documentNumber": "87654321",
    "phone": "987654321"
  },
  "warranty": false,
  "secureBilling": false,
  "securityCode": "5858",
  "documentation": {
    "serie": "001",
    "number": "00000123"
  }
}
```

#### Ejemplo con Medidas Personalizadas
```json
{
  "productType": "custom",
  "origin": "LIMA",
  "destination": "CUSCO",
  "recipient": {
    "documentType": "dni",
    "documentNumber": "12345678"
  },
  "customDimensions": {
    "largo": 50,
    "ancho": 40,
    "alto": 30,
    "peso": 5
  },
  "securityCode": "7979"
}
```

#### Response (200 OK) - Registro exitoso
```json
{
  "success": true,
  "registrationNumber": "A57 - 69871525",
  "price": 8.00,
  "details": {
    "origin": "URB SANTA ELVIRA",
    "destination": "CHALA",
    "sender": "RONALD JESUS",
    "recipient": "CARGO"
  },
  "message": "Shipment registered successfully"
}
```

#### Response (400 Bad Request) - Campos faltantes
```json
{
  "error": "productType is required (sobre, xxs, xs, s, m, l, or custom)"
}
```

#### Response (400 Bad Request) - Clave inválida
```json
{
  "error": "securityCode cannot have consecutive digits (e.g., 1234, 4321)"
}
```

#### Response (400 Bad Request) - Error de registro
```json
{
  "success": false,
  "message": "DNI NO REALIZA ENVIO.",
  "error": "Registration failed"
}
```

#### Response (500 Error)
```json
{
  "error": "Shipment registration failed",
  "details": "Mensaje de error detallado"
}
```

#### Notas Importantes

1. **Búsqueda de ubicación**: Los campos `origin` y `destination` son textos de búsqueda. El sistema buscará y seleccionará la primera coincidencia.

2. **Validación de DNI/RUC**: El sistema valida los documentos contra la base de datos de RENIEC/SUNAT. Si el documento no es válido o tiene restricciones, el registro fallará.

3. **Clave de seguridad**: No puede tener dígitos consecutivos (ej: 1234, 4321, 2345). Si no se proporciona, se usa `5858` por defecto.

4. **Tiempo de entrega**: Después de registrar el envío, tiene 24 horas para llevarlo a la agencia de origen.

5. **Usuario autenticado**: El usuario debe estar previamente autenticado (haber llamado a `/login`) para poder registrar envíos.

---

## 📊 Códigos de Estado HTTP

| Código | Descripción                                           |
|--------|-------------------------------------------------------|
| `200`  | ✅ Operación exitosa                                  |
| `400`  | ⚠️ Solicitud inválida (faltan parámetros requeridos) |
| `401`  | 🔒 No autorizado (falta header x-api-key)            |
| `403`  | 🚫 Prohibido (API Key inválida o instancia inactiva) |
| `500`  | ❌ Error interno del servidor                         |

---

## 💡 Ejemplos de Uso

### Flujo completo con cURL

#### 1. Crear una instancia
```bash
curl -X POST http://localhost:3000/instances
```

#### 2. Iniciar sesión
```bash
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -H "x-api-key: TU_API_KEY_AQUI" \
  -d '{"username": "usuario@ejemplo.com", "password": "miContraseña123"}'
```

#### 3. Verificar estado
```bash
curl -X GET http://localhost:3000/status \
  -H "x-api-key: TU_API_KEY_AQUI"
```

#### 4. Cerrar sesión
```bash
curl -X POST http://localhost:3000/logout \
  -H "x-api-key: TU_API_KEY_AQUI"
```

#### 5. Eliminar instancia
```bash
curl -X DELETE http://localhost:3000/instances \
  -H "x-api-key: TU_API_KEY_AQUI"
```

---

### Ejemplo con JavaScript (fetch)

```javascript
// Crear instancia
const createInstance = async () => {
  const response = await fetch('http://localhost:3000/instances', {
    method: 'POST'
  });
  return response.json();
};

// Login
const login = async (apiKey, username, password) => {
  const response = await fetch('http://localhost:3000/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify({ username, password, retries: 3 })
  });
  return response.json();
};

// Obtener estado
const getStatus = async (apiKey) => {
  const response = await fetch('http://localhost:3000/status', {
    headers: { 'x-api-key': apiKey }
  });
  return response.json();
};

// Ejemplo de uso
(async () => {
  // 1. Crear instancia
  const { apiKey, instanceId } = await createInstance();
  console.log('Instancia creada:', instanceId);
  
  // 2. Hacer login
  const loginResult = await login(apiKey, 'usuario@test.com', 'password123');
  console.log('Login:', loginResult);
  
  // 3. Verificar estado
  const status = await getStatus(apiKey);
  console.log('Estado:', status);
})();
```

---

## 🛠 Tecnologías Utilizadas

| Tecnología | Versión  | Descripción                                    |
|------------|----------|------------------------------------------------|
| Node.js    | -        | Entorno de ejecución JavaScript                |
| Fastify    | 5.6.2    | Framework web de alto rendimiento              |
| Playwright | 1.58.0   | Automatización de navegadores (Chromium/Firefox/WebKit)|
| UUID       | 13.0.0   | Generación de identificadores únicos           |
| dotenv     | 17.2.3   | Gestión de variables de entorno                |

---

## ⚙️ Variables de Entorno

| Variable | Default | Descripción                    |
|----------|---------|--------------------------------|
| `PORT`   | `3000`  | Puerto en el que escucha la API |

---

## 📝 Notas Adicionales

### Comportamiento del Login

- El sistema detecta automáticamente si ya se está autenticado
- En caso de fallo, realiza reintentos automáticos (configurable)
- Entre cada reintento hay una espera de 2 segundos
- La página se recarga entre reintentos para limpiar el estado

### Comportamiento del Logout

El proceso de logout incluye:
1. Limpieza de cookies del navegador
2. Limpieza de caché del navegador
3. Limpieza de `localStorage`
4. Limpieza de `sessionStorage`
5. Navegación de vuelta a la página de login

---

## 💡 Catálogo de Destinos y Productos

Para ver la lista completa de códigos de productos disponibles y el catálogo de agencias/destinos, consulta el archivo:
👉 **[SHALOM_CATALOG.md](./SHALOM_CATALOG.md)**

---

## 📞 Soporte

Para reportar problemas o solicitar nuevas funcionalidades, contacta al equipo de desarrollo.

---

*Documentación generada el 24 de Enero de 2026*
