#!/usr/bin/env python3
"""
GhostHub Server Entry Point
---------------------------
Initializes and runs the Flask application with SocketIO using gevent for WebSockets.
Supports optional Cloudflare Tunnel for public sharing.

Environment Variables:
- FLASK_CONFIG: 'development' (default) or 'production'
- PORT: Server port number (default: 5000)
"""

import os
import sys
# Apply gevent monkey patching early to ensure proper async I/O
from gevent import monkey
monkey.patch_all()

# Import server utilities after monkey patching
from app.utils.server_utils import (
    initialize_app, 
    display_server_info, 
    find_cloudflared_path,
    start_cloudflare_tunnel,
    run_server,
    cleanup_tunnel
)

# Get configuration from environment variables
config_name = os.getenv('FLASK_CONFIG', 'development')
port = int(os.getenv('PORT', 5000))

# Initialize the Flask application
app = initialize_app(config_name, port)

if __name__ == '__main__':
    # Display server information
    display_server_info(config_name, port)
    
    # Find cloudflared executable
    cloudflared_path = find_cloudflared_path()
    
    # Prompt for tunnel usage
    tunnel_process = None
    if cloudflared_path:
        try:
            use_tunnel = input("Do you want to expose this server using Cloudflare Tunnel? (y/n): ")
            tunnel_process = start_cloudflare_tunnel(cloudflared_path, port, use_tunnel)
        except Exception as e:
            print(f"[!] Error handling Cloudflare Tunnel: {e}")
    
    try:
        # Run the server (blocking call)
        run_server(app, port, debug=app.config.get('DEBUG', False))
    finally:
        # Clean up tunnel process if it exists
        cleanup_tunnel(tunnel_process)
