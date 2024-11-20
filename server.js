import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createBareServer } from "@nebula-services/bare-server-node";
import chalk from "chalk";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import basicAuth from "express-basic-auth";
import mime from "mime";
import axios from "axios";
import cheerio from "cheerio";
import config from "./config.js";

console.log(chalk.yellow("🚀 Starting proxy search engine..."));

const __dirname = process.cwd();
const server = http.createServer();
const app = express();
const bareServer = createBareServer("/fq/");
const PORT = process.env.PORT || 8080;
const cache = new Map();
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // Cache for 30 Days

if (config.challenge !== false) {
  console.log(
    chalk.green("🔒 Password protection is enabled! Listing logins below")
  );
  Object.entries(config.users).forEach(([username, password]) => {
    console.log(chalk.blue(`Username: ${username}, Password: ${password}`));
  });
  app.use(basicAuth({ users: config.users, challenge: true }));
}

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: true }));

// Proxy for search requests
app.get("/search/*", async (req, res, next) => {
  try {
    const searchQuery = req.path.slice(8); // Extract the query from URL
    if (cache.has(searchQuery)) {
      const { data, contentType, timestamp } = cache.get(searchQuery);
      if (Date.now() - timestamp > CACHE_TTL) {
        cache.delete(searchQuery);
      } else {
        res.writeHead(200, { "Content-Type": contentType });
        return res.end(data);
      }
    }

    const searchEngineUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;

    // Fetch the search results page from DuckDuckGo (or other search engines like Google)
    const { data: htmlData } = await axios.get(searchEngineUrl);

    // Use Cheerio to parse the HTML and extract search results
    const $ = cheerio.load(htmlData);
    const results = [];

    $(".result__a").each((index, element) => {
      const title = $(element).text();
      const link = $(element).attr("href");
      const snippet = $(element).next().text(); // Fetch the next text block as the snippet

      results.push({ title, link, snippet });
    });

    // If no results are found
    if (results.length === 0) {
      return next();
    }

    // Format the results into an HTML response
    const resultHtml = `
      <html>
        <head><title>Search Results</title></head>
        <body>
          <h1>Search Results for "${searchQuery}"</h1>
          <ul>
            ${results
              .map(result => `<li><a href="${result.link}">${result.title}</a><p>${result.snippet}</p></li>`)
              .join("")}
          </ul>
        </body>
      </html>
    `;

    const contentType = "text/html";
    cache.set(searchQuery, { data: resultHtml, contentType, timestamp: Date.now() });

    res.writeHead(200, { "Content-Type": contentType });
    res.end(resultHtml);
  } catch (error) {
    console.error("Error fetching search results:", error);
    res.setHeader("Content-Type", "text/html");
    res.status(500).send("Error fetching search results.");
  }
});

const routes = [
  { path: "/", file: "index.html" },
  { path: "/tos", file: "tos.html" },
  { path: "/privacy", file: "privacy.html" },
];

routes.forEach(route => {
  app.get(route.path, (_req, res) => {
    res.sendFile(path.join(__dirname, "static", route.file));
  });
});

app.use((req, res, next) => {
  res.status(404).sendFile(path.join(__dirname, "static", "404.html"));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).sendFile(path.join(__dirname, "static", "404.html"));
});

server.on("request", (req, res) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on("listening", () => {
  console.log(chalk.green(`🌍 Proxy search engine running on http://localhost:${PORT}`));
});

server.listen({ port: PORT });
