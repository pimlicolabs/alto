# Stage 1: Build Contracts using Foundry and Node/pnpm
# Use the specified Foundry image version
FROM ghcr.io/foundry-rs/foundry:v1.1.0 AS builder

# Set working directory for the build stage
WORKDIR /build

# Copy the entire project context into the builder stage
COPY . .

# --- FIX: Switch to root user to install packages ---
USER root
# ----------------------------------------------------

# Install Node.js v20 and enable pnpm
# Assumes the base image is Debian/Ubuntu-based. Adjust if needed (e.g., use apk for Alpine).
RUN apt-get update && \
    # Install dependencies needed for adding repository and node itself
    apt-get install -y curl gnupg ca-certificates && \
    # Add NodeSource repository for Node.js 20.x
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    # Install nodejs (which includes npm)
    apt-get install -y nodejs && \
    # Clean up apt cache
    rm -rf /var/lib/apt/lists/* && \
    # Enable pnpm using corepack (comes with Node.js >= 16.17)
    corepack enable

# --- Optional: Switch back to original user if needed ---
# If the foundry image uses a specific user (e.g., 'foundry' or 'node')
# and subsequent pnpm commands should run as that user, switch back.
# Check the base image documentation for the default user if necessary.
# USER <original_user_name>
# For example: USER node
# If unsure, you can often omit this in a builder stage.

# Install project dependencies required for the contract build script
# Using --frozen-lockfile ensures reproducibility based on pnpm-lock.yaml
# This will run as root unless you switched back to a different user above
RUN pnpm install --frozen-lockfile

# Run the contract build script
# This will run as root unless you switched back to a different user above
# Assuming output goes to ./src/contracts (i.e., /build/src/contracts)
RUN pnpm run build:contracts

# ---

# Stage 2: Production Runtime Environment
# Use the specified Node.js Alpine image version for a smaller final image
FROM node:20.12.2-alpine3.19 AS production

# Set working directory for the application
WORKDIR /app

# Install typescript globally (as requested by user)
# Note: Project-level dependency is generally preferred over global install.
RUN npm install -g typescript

# Copy package manifests required to install dependencies
# Copy pnpm-workspace.yaml if it exists and is needed for your project structure
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
# The '*' makes the copy non-fatal if pnpm-workspace.yaml doesn't exist

# Enable pnpm using corepack (comes with Node.js >= 16.17)
RUN corepack enable

# Copy the entire project source code (as requested in the template)
# This might be optimizable depending on what 'pnpm build' and 'pnpm start' strictly need
COPY . .

# Copy ONLY the built contracts from the 'builder' stage
# Source: /build/src/contracts (WORKDIR/src/contracts from stage 1)
# Destination: ./src/contracts (WORKDIR/src/contracts in stage 2, i.e., /app/src/contracts)
COPY --from=builder /build/src/contracts ./src/contracts

# Fetch dependencies based on the lockfile to optimize installation
RUN pnpm fetch

# Install production dependencies recursively (if using workspaces)
# --offline flag uses the packages fetched in the previous step
# --prod flag could be added if devDependencies are not needed for runtime or 'pnpm build'
RUN pnpm install -r --offline --frozen-lockfile

# Build the application (e.g., transpile TypeScript)
RUN pnpm build

# --- Optional Steps from User Template (Kept commented out) ---
# remove dev dependencies (Alternative to installing with --prod flag)
# RUN pnpm prune --prod

# --- Final Runtime Configuration ---

# Expose necessary port (if your application listens on one)
# EXPOSE 3000

# Set the command to run the application
ENTRYPOINT ["pnpm", "start"]