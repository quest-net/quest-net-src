# Quest-Net

You can try the webapp at https://quest-net.github.io

Quest-Net is a real-time collaborative web application designed for tabletop role-playing game sessions. It provides a shared digital space where Dungeon Masters (DMs) and players can interact with characters, manage inventories, and coordinate gameplay elements in real-time.

## Features

### For Dungeon Masters
* Create and manage characters with custom stats, equipment, and skills
* Maintain a catalog of items and abilities that can be distributed to players
* Control the visual environment with a dynamic scene management system
* Track combat encounters with initiative and turn management
* Spawn field entities for battles and interactions
* Perform party-wide actions like healing and resource restoration
* Automatic and manual saving of game states with import/export functionality

![image](https://github.com/user-attachments/assets/fac373b7-a8ec-4df3-81d0-e54c895ec547)

### For Players
* Select and control characters
* Manage inventory, equipment, and skills
* Track character stats (HP, MP, SP) and resources
* Interact with other party members and field entities
* View real-time updates of the game environment

[Screenshot: Player view showing character sheet and inventory]

## Game Elements

### Characters
* Customizable stats including HP (Health Points), MP (Magic Points), and SP (Skill Points)
* Equipment slots for gear management
* Inventory system with usable and equippable items
* Skill lists with usage tracking
* Character portrait support

### Items and Skills
* Create custom items with use limits and equippable properties
* Design skills with damage values and SP costs
* Tag system for easy categorization and searching
* Image support for visual representation
* Usage tracking for limited-use abilities

### Entities
* **Global Entities**: Reusable NPCs and creatures stored in the DM's catalog
* **Field Entities**: Active combatants and interactive elements on the current scene
* Both types support full stat tracking, inventories, and skills
* Can be targets for player interactions and combat

### Visual System
* Support for environment and focus images
* Scene management with multiple view modes
* Image catalog for quick access to frequently used visuals
* Automatic image optimization for efficient sharing

[Screenshot: Entity management and visual system interface]

## How It Works

Quest-Net uses a peer-to-peer architecture powered by Trystero's MQTT implementation:
* The DM creates a room and shares the unique room code
* Players join using the room code
* All game state changes are synchronized in real-time via MQTT
* Images and assets are automatically shared between participants
* No central server required - everything happens directly between participants

## Getting Started

1. **As a DM:**
   * Visit the webapp
   * Click "Create a Lobby"
   * Share the room code with your players
   * Set up your game elements through the DM interface

2. **As a Player:**
   * Visit the webapp
   * Click "Join a Lobby"
   * Enter the room code provided by your DM
   * Select or create your character

[Screenshot: Main menu showing create/join options]

## Technical Implementation

* Built with React and TypeScript
* Real-time synchronization using Trystero with MQTT
* Efficient image handling with automatic compression and caching
* Dark/light theme support with Tailwind CSS
* Responsive design for various screen sizes
* Local storage system for game state persistence
* Comprehensive import/export functionality

## Contributing

Quest-Net is an open-source project. Contributions are welcome through:
* Bug reports
* Feature suggestions
* Code contributions
* Documentation improvements

## Credits

-All made by Julien Samuel Eddy Guimez, aka Xorcist137
