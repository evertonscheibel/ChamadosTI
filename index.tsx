import React from "react";
import ReactDOM from "react-dom/client";
import App from "./central/CentralApp";
import ChatbotSimulator from "./central/ChatbotSimulator";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get("chatbot") === "1" ? (
      <ChatbotSimulator />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
