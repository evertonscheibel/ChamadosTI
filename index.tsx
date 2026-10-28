import React from "react";
import ReactDOM from "react-dom/client";
import App from "./central/CentralApp";
import ChatbotSimulator from "./central/ChatbotSimulator";
import Atendimento from "./central/Atendimento";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const params = new URLSearchParams(window.location.search);
const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {params.get("chatbot") === "1" ? (
      <ChatbotSimulator />
    ) : params.get("atendimento") === "1" ? (
      <Atendimento />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
