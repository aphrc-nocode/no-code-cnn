FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --no-audit --no-fund

# Copy the rest of the application
COPY . .

# Expose Vite dev server port
EXPOSE 5173

# Run the dev server with host binding
CMD ["npm", "run", "dev", "--", "--host"]
