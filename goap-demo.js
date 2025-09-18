#!/usr/bin/env node
/**
 * Interactive GOAP System Demonstration
 * Run with: node goap-demo.js
 */

import { DeploymentScenario } from './deployment-scenario.js';

async function main() {
    console.log(`
╔════════════════════════════════════════════════════════════════════╗
║                                                                    ║
║    🎯 Goal-Oriented Action Planning (GOAP) System Demo            ║
║                                                                    ║
║    Advanced AI Planner with A* Pathfinding & OODA Loop            ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
`);

    const demo = new DeploymentScenario();
    
    try {
        await demo.runFullDemonstration();
        
        console.log(`
╔════════════════════════════════════════════════════════════════════╗
║                                                                    ║
║    ✅ GOAP Demonstration Complete!                                 ║
║                                                                    ║
║    Key Features Showcased:                                         ║
║    • A* pathfinding for optimal planning                          ║
║    • OODA loop execution monitoring                               ║
║    • Adaptive replanning on state changes                         ║
║    • Mixed LLM/code execution strategies                          ║
║    • Real-world deployment scenarios                              ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
`);
        
    } catch (error) {
        console.error('❌ Demo failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { main };