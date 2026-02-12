import React from "react";
import { Editor } from "../editor";
import "../styles/global.css";

export function App() {
  return (
    <div className="app">
      <header className="app__header">
        <h1>lipu sitelen wawa</h1>
      </header>
      <main className="app__main">
        <Editor />
      </main>
      <footer className="app__footer">
        <p>nasin nanpa font by ETBCOR</p>
      </footer>
    </div>
  );
}
