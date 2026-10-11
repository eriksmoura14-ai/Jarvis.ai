import { Plugin, PluginSettingTab, Setting, Notice, Modal, TFile, requestUrl, type App, type ToggleComponent } from 'obsidian';
import { inVaultScope, validVaultFolder, validHash, normalizeMarkdown, restoredBaselines, type SyncRequest } from '../shared/obsidian';
import { MAX_KNOWLEDGE_NOTES, MAX_LIBRARY_BYTES, MAX_NOTE_BYTES, KNOWLEDGE_CAPACITY_LABEL } from '../shared/knowledge';
import { SyncEngine, type VaultBridge } from './sync-engine';
interface Settings { url: string; token: string; folder: string; enabled: boolean; writeback: boolean; baselines: Record<string, string> }
const defaults: Settings = { url: 'https://jarvis-ai-dwqp.onrender.com', token: '', folder: '', enabled: false, writeback: false, baselines: {} };
function serverURL(raw: string) {
  const url = new URL(raw.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['/', ''].includes(url.pathname)) throw new Error('Use somente o endereço HTTPS do JARVIS, sem caminhos ou credenciais.');
  return url.origin;
}
export default class JarvisPlugin extends Plugin {
  settings: Settings = { ...defaults, baselines: {} }; engine?: SyncEngine; status = 'Configure a conexão. Nenhuma sincronização foi ativada.';
  private tab!: JarvisSettingsTab; private debounce?: number; private unloaded = false;
  async onload() {
    const saved = await this.loadData() as Partial<Settings> | null;
    this.settings = { ...defaults, ...saved, baselines: restoredBaselines(saved?.baselines) };
    this.tab = new JarvisSettingsTab(this.app, this); this.addSettingTab(this.tab);
    this.addCommand({ id: 'sync', name: 'Sincronizar cofre com JARVIS', callback: () => void this.sync(true) });
    const schedule = () => {
      if (this.debounce) window.clearTimeout(this.debounce);
      this.debounce = window.setTimeout(() => void this.sync(), 5000);
    };
    this.registerEvent(this.app.vault.on('modify', schedule));
    this.registerEvent(this.app.vault.on('create', schedule));
    this.registerEvent(this.app.vault.on('rename', schedule));
    this.registerEvent(this.app.vault.on('delete', schedule));
    this.registerInterval(window.setInterval(() => void this.sync(), 30_000));
    this.app.workspace.onLayoutReady(() => { if (this.settings.enabled) void this.sync(); });
  }
  onunload() { this.unloaded = true; if (this.debounce) window.clearTimeout(this.debounce); this.engine?.stop(); }
  async saveSettings(reset = false) {
    if (reset) { this.settings.enabled = false; this.engine?.stop(); this.engine = undefined; this.settings.baselines = {}; this.status = 'Conexão alterada. Confira pasta e endereço e ative a sincronização novamente.'; this.tab.pause(); }
    await this.saveData(this.settings);
  }
  private getEngine() {
    if (this.engine) return this.engine;
    const origin = serverURL(this.settings.url); if (!validHash(this.settings.token)) throw new Error('Cole a chave de vinculação gerada dentro do JARVIS.');
    if (!validVaultFolder(this.settings.folder)) throw new Error('Use uma pasta relativa do cofre, sem barra final, “..” ou pastas ocultas.');
    const vault = this.app.vault;
    const fileAt = (path: string) => { const file = vault.getAbstractFileByPath(path); if (!(file instanceof TFile) || !inVaultScope(path, this.settings.folder)) throw new Error('A nota não existe mais no escopo selecionado.'); return file; };
    const bridge: VaultBridge = {
      readFiles: async folder => {
        const files = vault.getMarkdownFiles().filter(file => inVaultScope(file.path, folder));
        if (files.length > MAX_KNOWLEDGE_NOTES) throw new Error(`Escolha uma pasta com até ${KNOWLEDGE_CAPACITY_LABEL}.`);
        if (files.filter(file => file.stat.size <= MAX_NOTE_BYTES).reduce((sum, file) => sum + file.stat.size, 0) > MAX_LIBRARY_BYTES) throw new Error(`Escolha uma pasta com até ${KNOWLEDGE_CAPACITY_LABEL}.`);
        return Promise.all(files.map(async file => ({ path: file.path, content: file.stat.size > MAX_NOTE_BYTES ? '' : await vault.read(file) })));
      },
      read: path => vault.read(fileAt(path)),
      backup: async (path, content) => {
        const folder = '.jarvis-backups'; if (!await vault.adapter.exists(folder)) await vault.adapter.mkdir(folder);
        const name = `${Date.now()}-${crypto.randomUUID()}.md`;
        // Preserve exact original bytes of text; path metadata is in a separate file.
        await vault.adapter.write(`${folder}/${name}`, content);
        await vault.adapter.write(`${folder}/${name}.json`, JSON.stringify({ path, savedAt: new Date().toISOString() }));
      },
      replace: async (path, expected, next, permitted) => {
        await vault.process(fileAt(path), current => {
          if (!permitted() || normalizeMarkdown(current) !== normalizeMarkdown(expected)) throw new Error('A nota mudou durante a gravação. Backup preservado; arquivo não sobrescrito.');
          return next;
        });
      },
    };
    const token = this.settings.token;
    const send = async (body: SyncRequest) => {
      let timeout: number | undefined;
      try {
        const response = await Promise.race([
          requestUrl({ url: origin + '/api/obsidian/sync', method: 'POST', contentType: 'application/json', headers: { Authorization: `Bearer ${token}`, 'X-Jarvis-Client': '1' }, body: JSON.stringify(body), throw: false }),
          new Promise<never>((_, reject) => { timeout = window.setTimeout(() => reject(new Error('Servidor demorou para responder. O próximo ciclo tentará novamente.')), 45_000); }),
        ]);
        if (response.status !== 200) throw new Error(response.status === 401 ? 'Chave inválida, expirada ou revogada. Gere outra no JARVIS.' : response.status === 429 ? 'Muitas sincronizações. Aguarde um minuto.' : 'Não foi possível sincronizar. Verifique a conexão e tente novamente.');
        return response.json as unknown;
      } finally { if (timeout) window.clearTimeout(timeout); }
    };
    const state = { baselines: this.settings.baselines };
    this.engine = new SyncEngine(bridge, send, state, async () => { this.settings.baselines = state.baselines; await this.saveSettings(); }, this.settings.folder, () => this.settings.enabled && this.settings.writeback);
    return this.engine;
  }
  async sync(notify = false) {
    if (this.unloaded) return;
    if (!this.settings.enabled) { if (notify) new Notice('Ative a sincronização nas configurações do plugin.'); return; }
    try { const engine = this.getEngine(); if (engine.busy) return; this.status = 'Sincronizando…'; this.tab.updateStatus(); this.status = await engine.sync(); }
    catch (cause) { this.status = cause instanceof Error ? cause.message : 'Falha na sincronização.'; }
    this.tab.updateStatus(); if (notify) new Notice(this.status);
  }
}
class ConflictModal extends Modal {
  constructor(app: App, private plugin: JarvisPlugin, private path: string) { super(app); }
  onOpen() {
    const conflict = this.plugin.engine?.conflicts.get(this.path); if (!conflict) { this.close(); return; }
    this.contentEl.addClass('jarvis-conflict');
    this.titleEl.setText('Comparar antes de substituir');
    this.contentEl.createEl('p', { text: this.path });
    this.contentEl.createEl('p', { text: 'Escolha conscientemente. A versão substituída será preservada em .jarvis-backups. Nenhum arquivo é excluído automaticamente.' });
    const local = this.contentEl.createEl('pre', { text: 'Lendo versão do Obsidian…' });
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (file instanceof TFile) void this.app.vault.read(file).then(text => { local.setText(text); }).catch(() => local.setText('A nota não pôde ser lida. Feche e tente novamente.'));
    this.contentEl.createEl('h3', { text: 'Versão JARVIS' });
    this.contentEl.createEl('pre', { text: conflict.remote?.content ?? (conflict.reason === 'removed' ? 'Cópia removida da conta; arquivo local preservado.' : 'Limite da biblioteca atingido.') });
    const message = this.contentEl.createEl('p');
    const choose = async (choice: 'local' | 'remote') => {
      try { await this.plugin.engine!.resolve(this.path, choice); this.plugin.status = 'Conflito resolvido com backup.'; this.close(); await this.plugin.sync(); }
      catch (cause) { message.setText(cause instanceof Error ? cause.message : 'Falha ao resolver.'); }
    };
    new Setting(this.contentEl).setName('Usar versão do Obsidian').setDesc('Atualiza a cópia no JARVIS, após verificar que ela não mudou novamente.').addButton(button => button.setButtonText('Confirmar Obsidian').onClick(() => void choose('local')));
    if (conflict.remote) new Setting(this.contentEl).setName('Usar versão do JARVIS').setDesc('Requer permissão de escrita ativada. Cria backup antes de substituir o arquivo local.').addButton(button => button.setButtonText('Confirmar JARVIS').onClick(() => void choose('remote')));
  }
  onClose() { this.contentEl.empty(); }
}
class JarvisSettingsTab extends PluginSettingTab {
  private statusEl?: HTMLElement; private conflictsEl?: HTMLElement; private enabledToggle?: ToggleComponent;
  pause() { this.enabledToggle?.setValue(false); this.updateStatus(); }
  constructor(app: App, private plugin: JarvisPlugin) { super(app, plugin); }
  updateStatus() {
    this.statusEl?.setText(this.plugin.status); this.conflictsEl?.empty();
    if (this.conflictsEl) for (const conflict of this.plugin.engine?.conflicts.values() ?? []) {
      new Setting(this.conflictsEl).setName(conflict.path).setDesc(conflict.reason === 'limit' ? `A biblioteca permite até ${KNOWLEDGE_CAPACITY_LABEL}. Confira o uso no JARVIS e tente novamente; libere espaço se estiver cheia.` : 'Duas versões diferentes. Compare antes de substituir.').addButton(button => button.setButtonText('Comparar').onClick(() => new ConflictModal(this.app, this.plugin, conflict.path).open())).addButton(button => button.setButtonText('Tentar novamente').onClick(() => { this.plugin.engine?.retry(conflict.path); void this.plugin.sync(true); }));
    }
  }
  display() {
    const { containerEl } = this; containerEl.empty();
    containerEl.createEl('h2', { text: 'JARVIS — Conexão do cofre' });
    containerEl.createEl('p', { text: 'Notas selecionadas são enviadas à sua conta JARVIS. Trechos pertinentes podem ser enviados ao provedor de IA quando você conversar. Não inclua senhas. Funciona enquanto o Obsidian estiver ativo; Android pode suspender o aplicativo.' });
    const input = (name: string, key: 'url' | 'token' | 'folder', description: string) => new Setting(containerEl).setName(name).setDesc(description).addText(text => {
      text.setValue(this.plugin.settings[key]); if (key === 'token') text.inputEl.type = 'password';
      text.onChange(async value => { this.plugin.settings[key] = value.trim(); await this.plugin.saveSettings(true); });
    });
    input('Endereço do JARVIS', 'url', 'Somente HTTPS; exemplo: https://jarvis-ai-dwqp.onrender.com');
    input('Chave de vinculação', 'token', 'JARVIS → Biblioteca → Conectar Obsidian. Não use senha pessoal, chave Supabase ou chave da IA. Guardada localmente em data.json: não compartilhe este arquivo. Expira em 180 dias e pode ser revogada.');
    input('Pasta do cofre', 'folder', `Vazio inclui todo o cofre. Exemplo: 02 Estudos. Até ${KNOWLEDGE_CAPACITY_LABEL}. Arquivos vazios ou acima de 50 KB, anexos e pastas ocultas são ignorados. Mudar esta opção inicia uma nova comparação, sem substituir versões diferentes.`);
    new Setting(containerEl).setName('Ativar sincronização').setDesc('Autoriza o envio de notas. A cada 30 segundos e após edições, até 20 notas/250 KB por ciclo.').addToggle(toggle => { this.enabledToggle = toggle; toggle.setValue(this.plugin.settings.enabled).onChange(async value => { this.plugin.settings.enabled = value; this.plugin.engine?.stop(); this.plugin.engine = undefined; await this.plugin.saveSettings(); if (value) void this.plugin.sync(true); }); });
    new Setting(containerEl).setName('Receber alterações do JARVIS').setDesc('Permite gravar no cofre as edições feitas pelo navegador. Backup obrigatório em .jarvis-backups antes de substituir; arquivos nunca são excluídos.').addToggle(toggle => toggle.setValue(this.plugin.settings.writeback).onChange(async value => { this.plugin.settings.writeback = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Sincronizar agora').addButton(button => button.setButtonText('Sincronizar').onClick(() => void this.plugin.sync(true)));
    this.statusEl = containerEl.createEl('p'); this.conflictsEl = containerEl.createDiv(); this.updateStatus();
    containerEl.createEl('p', { text: 'Renomear cria outro caminho na conta; excluir em um lado preserva o outro. Backups não são apagados automaticamente. Não execute simultaneamente outro sincronizador nas mesmas notas.' });
  }
}
