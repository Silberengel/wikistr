#!/bin/bash
# Start script for AsciiDoctor server

# Set default port if not provided
export ASCIIDOCTOR_PORT=${ASCIIDOCTOR_PORT:-8091}
export ASCIIDOCTOR_ALLOW_ORIGIN=${ASCIIDOCTOR_ALLOW_ORIGIN:-*}

# Change to deployment directory
cd "$(dirname "$0")"

# Check if bundler is installed
if ! command -v bundle &> /dev/null; then
    echo "Error: bundler is not installed. Install it with: gem install bundler"
    exit 1
fi

# Install dependencies if Gemfile.lock doesn't exist
if [ ! -f "Gemfile.lock" ]; then
    echo "Installing Ruby dependencies..."
    bundle install
fi

# Start the server
echo "Starting AsciiDoctor server on port $ASCIIDOCTOR_PORT..."
bundle exec ruby asciidoctor-server.rb

