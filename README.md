# ✈️ Agentic Airport

This project an air traffic control simulation where an AI agent acts as the controller in the tower. It is an experiment designed to explore agentic AI capabilities in controlling multiple objects in an active space.

## 🎯 Objective

Land as many planes as possible without collisions. The AI agent autonomously guides all aircraft to the runway.

https://github.com/user-attachments/assets/4ead616b-1d0d-49be-9b61-cb6a378575fb

## 📊 Results

The results were impressive. A single agent can navigate 6+ planes simultaneously and land them successfully. With random spawn positions and varying AI responses, results vary — but the AI consistently lands 3-4 planes without crashing.

## ⚡ Performance Notes

- **Model used:** OpenAI GPT-4o-mini (a relatively weak model) — stronger models would perform better
- **Game speed matters:** Slowing down the simulation gives the AI more decision cycles, improving performance
- **Screen size:** The bigger your monitor is the more room for planes to move around, giving more time for AI to react

## 🔮 Future Exploration

Since this was primarily an experiment, I kept the architecture simple. Potential improvements include:

- Dedicated agent per airplane
- Master controller agent overseeing all traffic
- Multi-agent coordination

Browser-based HTTP requests create a natural waterfall/queue in the AI service, so I focused on maximizing what a single agent could achieve — which was already very impressive.

## 🛠️ Development

```bash
npm install
npm run dev
```

## 🎥 Another example

https://github.com/user-attachments/assets/17f05d64-04de-409e-b6de-41363b1106f0

## ❤️ Contributions

Open source is built by the community for the community. All contributions to this project are welcome!<br>
Additionally, if you have any suggestions for enhancements, ideas on how to take the project further or have discovered a bug, do not hesitate to create a new issue ticket and we will look into it as soon as possible!
