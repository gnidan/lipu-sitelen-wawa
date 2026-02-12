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
          <SP>o sitelen lon(ni&amp;&lt;v)</SP>
        </p>
      </header>
      <main className="app__main">
        <Editor />
      </main>
      <footer className="app__footer">
        <p>
          <SP>nasin sitelen[</SP>
          <a href="https://github.com/ETBCOR/nasin-nanpa">
            <SP>nasin-nanpa</SP>
          </a>
          <SP>] li tan jan[ijo tan anpa nanpa]</SP>
        </p>
      </footer>
    </div>
  );
}
