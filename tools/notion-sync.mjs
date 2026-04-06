#!/usr/bin/env node
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(__dirname, "../_posts");

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00 +0900`;
}

async function syncPosts() {
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      property: "Published",
      checkbox: { equals: true },
    },
  });

  for (const page of response.results) {
    const props = page.properties;

    const title =
      props.Name?.title?.[0]?.plain_text ||
      props.Title?.title?.[0]?.plain_text ||
      "untitled";

    const dateRaw = props.Date?.date?.start;
    if (!dateRaw) {
      console.log(`Skipping "${title}" — no Date set`);
      continue;
    }

    const date = formatDate(dateRaw);
    const datePrefix = dateRaw.slice(0, 10);
    const slug = slugify(title);
    const filename = `${datePrefix}-${slug}.md`;
    const filepath = path.join(POSTS_DIR, filename);

    const tags = (props.Tags?.multi_select || []).map((t) => t.name);
    const math = props.Math?.checkbox ?? false;
    const categories = (props.Categories?.multi_select || []).map((c) => c.name);

    const mdBlocks = await n2m.pageToMarkdown(page.id);
    const mdContent = n2m.toMarkdownString(mdBlocks);

    let frontMatter = `---\ntitle: ${JSON.stringify(title)}\ndate: ${date}\n`;
    if (math) frontMatter += `math: true\n`;
    if (categories.length) frontMatter += `categories: [${categories.map((c) => JSON.stringify(c)).join(", ")}]\n`;
    if (tags.length) frontMatter += `tags: [${tags.map((t) => JSON.stringify(t)).join(", ")}]\n`;
    frontMatter += `---\n\n`;

    const fullContent = frontMatter + (mdContent.parent || mdContent);

    fs.writeFileSync(filepath, fullContent, "utf8");
    console.log(`Synced: ${filename}`);
  }
}

syncPosts().catch((err) => {
  console.error(err);
  process.exit(1);
});
