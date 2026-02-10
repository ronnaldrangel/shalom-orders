# Usar la imagen oficial de Playwright que incluye Node.js y los navegadores necesarios
FROM mcr.microsoft.com/playwright:v1.58.0-noble

# Establecer directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma/

# Instalar dependencias
RUN npm ci

# Generar cliente de Prisma
RUN npx prisma generate

# Copiar el código fuente
COPY . .

# Exponer el puerto
EXPOSE 3000

# Variables de entorno por defecto (pueden ser sobrescritas)
ENV PORT=3000
ENV HEADLESS=true
ENV NODE_ENV=production

# Comando para iniciar la aplicación sincronizando el esquema directamente (sin migraciones)
CMD ["/bin/sh", "-c", "npx prisma db push && node src/index.js"]
