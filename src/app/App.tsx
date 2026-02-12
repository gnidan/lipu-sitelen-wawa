import React from "react";
import { Editor } from "../editor";
import {
  SP,
} from "../components/SitelenPona";
import "../styles/global.css";

export function App() {
  return (
    <div className="app">
      <header className="app__header">
        <h1><SP>lipu+sitelen wawa</SP></h1>
        <p className="app__subtitle">
          <SP>o sitelen lon(ni)</SP>
        </p>
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
