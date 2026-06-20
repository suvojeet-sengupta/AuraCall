# Use Node.js LTS image
FROM node:20-alpine

# Set the working directory
WORKDIR /app

# Copy dependency definition files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy local application code to workdir
COPY . .

# Expose the server port
EXPOSE 3001

# Command to launch the server
CMD ["npm", "start"]
