# Stage 1: Builder
# This stage installs all dependencies, including devDependencies,
# and builds the TypeScript source code into JavaScript.
FROM node:24-alpine AS builder

# Define build argument for NPM_TOKEN
ARG NPM_TOKEN

# Set the working directory
WORKDIR /usr/src/gwtemplate-node-ts

# Copy package.json and package-lock.json
COPY package*.json ./

# Install all dependencies (including devDependencies needed for building)
RUN npm ci

# Copy the source code
COPY . ./

# Build the TypeScript code
# Fail fast on type errors before emitting build output.
RUN npm run type-check
RUN npm run build

# Stage 2: Production
# This stage creates the final, lean image for production.
FROM node:24-alpine

WORKDIR /usr/src/gwtemplate-node-ts

# Copy package.json and package-lock.json
COPY package*.json ./

# Install ONLY production dependencies
RUN npm ci --omit=dev

# Copy the compiled code from the builder stage
COPY --from=builder /usr/src/gwtemplate-node-ts/build ./build

# Copy the swagger configuration file, which is required at runtime
COPY --from=builder /usr/src/gwtemplate-node-ts/swagger.config.cjs ./

# Copy the pre-generated swagger specification
COPY --from=builder /usr/src/gwtemplate-node-ts/swagger-spec.json ./

# Copy generated OpenAPI profile documents used by Swagger UI profile selector
COPY --from=builder /usr/src/gwtemplate-node-ts/docs/openapi-profiles ./docs/openapi-profiles

# Copy runtime scripts (used by the start command)
COPY --from=builder /usr/src/gwtemplate-node-ts/scripts ./scripts

# Locale JSON is loaded from src/locales at runtime by the voice/localization adapter.
COPY --from=builder /usr/src/gwtemplate-node-ts/src/locales ./src/locales



# Expose the port the app runs on (assuming 3000, can be configured via .env)
EXPOSE 3000

# --- DEBUGGING STEP ---
# List the contents of the final working directory to verify that all files were copied correctly.
RUN ls -la

# The command to run the application
CMD [ "npm", "start" ]
