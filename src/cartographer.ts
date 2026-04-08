import { Project, SourceFile } from "ts-morph";
import * as crypto from "crypto";
import { execSync } from "child_process";
import * as fs from "fs";
import { promises as fsp } from "fs";
import { StorageLayer } from "./storage";
import { StructuralNode } from "./schemas";
import * as path from "path";

const PY_DEF = /^(?:async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm;
const PY_CLASS = /^class\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm;

function walkPyFiles(dir: string, skipDir: Set<string>, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (skipDir.has(e.name)) continue;
      walkPyFiles(full, skipDir, out);
    } else if (e.isFile() && e.name.endsWith(".py")) {
      out.push(full);
    }
  }
}

export class RepoCartographer {
  constructor(private storage: StorageLayer) {}

  async ingestRepo(rootPath: string) {
    const rootAbs = path.resolve(rootPath);
    const project = new Project({
      compilerOptions: { allowJs: true },
    });

    project.addSourceFilesAtPaths(path.join(rootAbs, "**/*.{ts,js}"));

    for (const sourceFile of project.getSourceFiles()) {
      const filePath = sourceFile.getFilePath();
      const content = sourceFile.getFullText();
      const hash = crypto.createHash("sha256").update(content).digest("hex");

      await this.storage.removeNodesByPath(filePath);

      const resolvedFileDeps = this.resolveFileDependencies(sourceFile);
      const fileId = `FILE:${filePath}`;

      const fileNode: StructuralNode = {
        id: fileId,
        type: "FILE",
        path: filePath,
        dependencies: resolvedFileDeps,
        dependents: [],
        hash: hash,
        bodyPreview: content.substring(0, 200) + "...",
        status: "VALID",
      };
      await this.storage.saveStructuralNode(fileNode);

      for (const iface of sourceFile.getInterfaces()) {
        const name = iface.getName();
        if (name) {
          const symId = this.scopedSymbolId(rootAbs, filePath, name);
          await this.storage.saveStructuralNode({
            id: symId,
            type: "SYMBOL",
            path: filePath,
            dependencies: [fileId, ...resolvedFileDeps],
            dependents: [],
            hash: crypto.createHash("sha256").update(iface.getText()).digest("hex"),
            bodyPreview: `interface ${name} { ... }`,
            status: "VALID",
          });
        }
      }

      for (const cls of sourceFile.getClasses()) {
        const name = cls.getName();
        if (name) {
          const symId = this.scopedSymbolId(rootAbs, filePath, name);
          await this.storage.saveStructuralNode({
            id: symId,
            type: "SYMBOL",
            path: filePath,
            dependencies: [fileId, ...resolvedFileDeps],
            dependents: [],
            hash: crypto.createHash("sha256").update(cls.getText()).digest("hex"),
            bodyPreview: `class ${name} { ... }`,
            status: "VALID",
          });

          for (const method of cls.getMethods()) {
            const methodName = method.getName();
            const methodId = this.scopedSymbolId(rootAbs, filePath, `${name}.${methodName}`);
            await this.storage.saveStructuralNode({
              id: methodId,
              type: "SYMBOL",
              path: filePath,
              dependencies: [fileId, symId, ...resolvedFileDeps],
              dependents: [],
              hash: crypto.createHash("sha256").update(method.getText()).digest("hex"),
              bodyPreview: method.getText().substring(0, 150) + "...",
              status: "VALID",
            });
          }
        }
      }

      for (const func of sourceFile.getFunctions()) {
        const name = func.getName();
        if (name) {
          const symId = this.scopedSymbolId(rootAbs, filePath, name);
          await this.storage.saveStructuralNode({
            id: symId,
            type: "SYMBOL",
            path: filePath,
            dependencies: [fileId, ...resolvedFileDeps],
            dependents: [],
            hash: crypto.createHash("sha256").update(func.getText()).digest("hex"),
            bodyPreview: func.getText().substring(0, 150) + "...",
            centrality: 0,
            coverage: 0,
            churn: 0,
            status: "VALID",
          });
        }
      }
    }

    await this.ingestPythonFiles(rootAbs);

    await this.backfillDependents();
    await this.calculateCodeRank();

    await this.storage.setMetadata("ingest_root", rootAbs);
    await this.storage.setMetadata("ingested_at", new Date().toISOString());
    await this.storage.setMetadata("git_head", this.tryGitSha(rootAbs) || "");
  }

  private scopedSymbolId(rootAbs: string, filePath: string, qualifiedName: string): string {
    const rel = path.relative(rootAbs, filePath).replace(/\\/g, "/");
    return `SYMBOL:${rel}::${qualifiedName}`;
  }

  /** ts-morph does not parse Python; add FILE + lightweight SYMBOL rows for .py so expand_handle works. */
  private async ingestPythonFiles(rootAbs: string) {
    const skip = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".venv", "venv", ".mypy_cache"]);
    const pyPaths: string[] = [];
    walkPyFiles(rootAbs, skip, pyPaths);

    for (const filePath of pyPaths) {
      const content = await fsp.readFile(filePath, "utf8");
      const hash = crypto.createHash("sha256").update(content).digest("hex");
      await this.storage.removeNodesByPath(filePath);

      const fileId = `FILE:${filePath}`;
      const fileNode: StructuralNode = {
        id: fileId,
        type: "FILE",
        path: filePath,
        dependencies: [],
        dependents: [],
        hash,
        bodyPreview: content.substring(0, 200) + (content.length > 200 ? "..." : ""),
        status: "VALID",
      };
      await this.storage.saveStructuralNode(fileNode);

      const names = new Set<string>();
      let m: RegExpExecArray | null;
      PY_DEF.lastIndex = 0;
      while ((m = PY_DEF.exec(content)) !== null) names.add(m[1]);
      PY_CLASS.lastIndex = 0;
      while ((m = PY_CLASS.exec(content)) !== null) names.add(m[1]);

      for (const name of names) {
        const symId = this.scopedSymbolId(rootAbs, filePath, name);
        await this.storage.saveStructuralNode({
          id: symId,
          type: "SYMBOL",
          path: filePath,
          dependencies: [fileId],
          dependents: [],
          hash: crypto.createHash("sha256").update(name).digest("hex"),
          bodyPreview: `${name} (python)`,
          status: "VALID",
        });
      }
    }
  }

  private resolveFileDependencies(sourceFile: SourceFile): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const imp of sourceFile.getImportDeclarations()) {
      const resolved = imp.getModuleSpecifierSourceFile();
      if (resolved) {
        const id = `FILE:${resolved.getFilePath()}`;
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
    }
    return out;
  }

  private tryGitSha(cwd: string): string | null {
    try {
      return execSync("git rev-parse HEAD", {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  }

  private async backfillDependents() {
    const nodes = await this.storage.getStructuralNodes();
    const incoming: Record<string, string[]> = {};
    for (const n of nodes) {
      for (const d of n.dependencies) {
        if (!incoming[d]) incoming[d] = [];
        if (!incoming[d].includes(n.id)) incoming[d].push(n.id);
      }
    }
    for (const n of nodes) {
      n.dependents = incoming[n.id] || [];
      await this.storage.saveStructuralNode(n);
    }
  }

  private async calculateCodeRank() {
    const nodes = await this.storage.getStructuralNodes();
    const inbound: Record<string, number> = {};
    for (const n of nodes) {
      for (const d of n.dependencies) {
        inbound[d] = (inbound[d] || 0) + 1;
      }
    }
    for (const node of nodes) {
      node.centrality = inbound[node.id] || 0;
      await this.storage.saveStructuralNode(node);
    }
  }
}
