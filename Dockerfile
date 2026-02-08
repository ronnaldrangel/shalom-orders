# Usar la imagen oficial de Playwright que incluye Node.js y los navegadores necesarios
FROM mcr.microsoft.com/playwright:v1.58.0-noble

# Establecer directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependencias
RUN npm ci

# Generar cliente de Prisma
RUN npx prisma generate

# Copiar el código fuente
COPY . .

# Dar permisos de ejecución al script de inicio
RUN chmod +x start.sh

# Exponer el puerto
EXPOSE 3000

# Variables de entorno por defecto (pueden ser sobrescritas)
ENV PORT=3000
ENV HEADLESS=true
ENV NODE_ENV=production

# Usar el script de inicio
CMD ["./start.sh"]
