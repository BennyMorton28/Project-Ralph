#!/bin/bash

echo "🔍 Finding Claude Code Configuration Directory..."
echo "================================================="

# Common locations for Claude Code config
POSSIBLE_PATHS=(
    "$HOME/.config/claude-code/mcp.json"
    "$HOME/.config/claude/mcp.json" 
    "$HOME/Library/Application Support/claude-code/mcp.json"
    "$HOME/Library/Application Support/Claude/mcp.json"
    "$HOME/.claude-code/mcp.json"
)

echo "Checking common locations:"
for path in "${POSSIBLE_PATHS[@]}"; do
    if [ -f "$path" ]; then
        echo "✅ FOUND: $path"
        echo "📄 Current contents:"
        cat "$path"
        echo ""
        echo "🎯 This is your Claude Code MCP config file!"
        exit 0
    elif [ -d "$(dirname "$path")" ]; then
        echo "📁 Directory exists but no mcp.json: $(dirname "$path")"
    else
        echo "❌ Not found: $path"
    fi
done

echo ""
echo "🔧 No existing MCP config found. Let's create one!"
echo ""

# Create the most common config directory
CONFIG_DIR="$HOME/.config/claude-code"
mkdir -p "$CONFIG_DIR"

echo "📁 Created directory: $CONFIG_DIR"

# Create the MCP configuration
cat > "$CONFIG_DIR/mcp.json" << 'EOF'
{
  "mcpServers": {
    "lightweight-playwright": {
      "command": "node",
      "args": ["/Users/benny/Downloads/Ralph/Project Ralph/lightweight-playwright-mcp/index.js"],
      "description": "Token-safe Playwright server for large sites like BMW dealerships"
    }
  }
}
EOF

echo "✅ Created MCP configuration file: $CONFIG_DIR/mcp.json"
echo ""
echo "📄 Configuration contents:"
cat "$CONFIG_DIR/mcp.json"
echo ""
echo "🚀 NEXT STEPS:"
echo "1. Restart Claude Code to load the new MCP server"
echo "2. Run: node smart_dealer_analyzer.mjs https://www.bramanbmwjupiter.com"
echo "3. Watch as it analyzes real BMW sites without token limits!"