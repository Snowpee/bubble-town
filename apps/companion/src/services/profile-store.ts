import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type {
  CreateProfileRequest,
  PrepareProfileForStorylineResponse,
  ProfileSummary,
  ResetProfileForStorylineResponse,
  ResetProfileRuntimeSummary,
  UpdateProfileRequest,
} from '@bubble-town/shared';
import { runHermesProfileCommand } from './profile-cli.js';
import { DEFAULT_PROFILE_ID, getActiveProfilePath, getConfigPath, getProfileHome, getProfilesRoot, getSessionsDir } from './hermes-paths.js';

const BUBBLE_TOWN_SOUL_MARKER = '## Bubble Town runtime contract';

function buildDefaultSoul(profileId: string): string {
  return [
    '# Bubble Town Assistant',
    '',
    `你是一个拟人化的本地陪伴助手，运行在 Hermes profile「${profileId}」中。`,
    '你自然、温和、可靠，会延续当前 Timeline里的关系、时间和重要事实。',
    '',
    BUBBLE_TOWN_SOUL_MARKER,
    '',
    '- 外部应用注入的 Bubble Town ContextPack 与 authoritative_time 是最高优先级上下文。',
    '- 不要依赖 Conversation started 判断当前时间；以 ContextPack 中的 now、timezone 和相对时间范围为准。',
    '- Hermes session 只是底层运行容器；即使底层 session 变化，也不要表现为第一次见到用户。',
    '- 使用记忆时自然表达，不要解释“系统记录”“数据库”“检索结果”或 ContextPack 来源。',
    '- 如果 ContextPack 明确表示没有检索到过去事件，不要编造具体回忆。',
    '',
  ].join('\n');
}

function buildRuntimeSoulContract(): string {
  return [
    '',
    BUBBLE_TOWN_SOUL_MARKER,
    '',
    '- 外部应用注入的 Bubble Town ContextPack 与 authoritative_time 是最高优先级上下文。',
    '- 不要依赖 Conversation started 判断当前时间；以 ContextPack 中的 now、timezone 和相对时间范围为准。',
    '- Hermes session 只是底层运行容器；即使底层 session 变化，也不要表现为第一次见到用户。',
    '- 使用记忆时自然表达，不要解释“系统记录”“数据库”“检索结果”或 ContextPack 来源。',
    '- 如果 ContextPack 明确表示没有检索到过去事件，不要编造具体回忆。',
    '',
  ].join('\n');
}

export function getActiveProfileId(): string {
  const activeProfilePath = getActiveProfilePath();
  if (!fs.existsSync(activeProfilePath)) {
    return DEFAULT_PROFILE_ID;
  }

  const value = fs.readFileSync(activeProfilePath, 'utf8').trim();
  return value || DEFAULT_PROFILE_ID;
}

function countProfileSessions(profileId: string): number {
  const sessionsDir = getSessionsDir(profileId);
  if (!fs.existsSync(sessionsDir)) {
    return 0;
  }

  return fs
    .readdirSync(sessionsDir)
    .filter((entry) => entry.startsWith('session_') && entry.endsWith('.json'))
    .length;
}

function getProfileUpdatedAt(profileId: string): string | undefined {
  const profileHome = getProfileHome(profileId);
  if (!fs.existsSync(profileHome)) {
    return undefined;
  }

  return fs.statSync(profileHome).mtime.toISOString();
}

function buildProfileSummary(profileId: string, activeProfileId: string): ProfileSummary {
  return {
    id: profileId,
    name: profileId,
    isActive: profileId === activeProfileId,
    sessionCount: countProfileSessions(profileId),
    updatedAt: getProfileUpdatedAt(profileId),
  };
}

function normalizeProfileId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

function resolveExistingProfileId(profileId: string): string | undefined {
  const requestedId = profileId?.trim() || DEFAULT_PROFILE_ID;
  if (requestedId === DEFAULT_PROFILE_ID) {
    return DEFAULT_PROFILE_ID;
  }

  const profilesRoot = getProfilesRoot();
  if (!fs.existsSync(profilesRoot)) {
    return undefined;
  }

  const profileIds = fs
    .readdirSync(profilesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  if (profileIds.includes(requestedId)) {
    return requestedId;
  }

  const normalizedId = normalizeProfileId(requestedId);
  if (profileIds.includes(normalizedId)) {
    return normalizedId;
  }

  return profileIds.find((id) => id.toLowerCase() === requestedId.toLowerCase());
}

export function listProfiles(): ProfileSummary[] {
  const activeProfileId = getActiveProfileId();
  const profiles = [buildProfileSummary(DEFAULT_PROFILE_ID, activeProfileId)];
  const profilesRoot = getProfilesRoot();

  if (!fs.existsSync(profilesRoot)) {
    return profiles;
  }

  const namedProfiles = fs
    .readdirSync(profilesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const profileId of namedProfiles) {
    profiles.push(buildProfileSummary(profileId, activeProfileId));
  }

  return profiles;
}

export function createProfile(input: CreateProfileRequest): ProfileSummary {
  runHermesProfileCommand(['create', input.name, '--clone', '--no-alias']);
  const createdId = normalizeProfileId(input.name);
  return listProfiles().find((profile) => profile.id === createdId) ?? buildProfileSummary(createdId, getActiveProfileId());
}

export function renameProfile(id: string, input: UpdateProfileRequest): ProfileSummary | undefined {
  try {
    runHermesProfileCommand(['rename', id, input.name]);
  } catch {
    return undefined;
  }

  const nextId = normalizeProfileId(input.name);
  return listProfiles().find((profile) => profile.id === nextId);
}

export function removeProfile(id: string): boolean {
  try {
    runHermesProfileCommand(['delete', id, '--yes']);
    return !fs.existsSync(path.join(getProfilesRoot(), id));
  } catch {
    return false;
  }
}

export function setActiveProfile(profileId: string): ProfileSummary | undefined {
  try {
    runHermesProfileCommand(['use', profileId]);
  } catch {
    return undefined;
  }

  return listProfiles().find((profile) => profile.id === profileId);
}

export function prepareProfileForStoryline(profileId: string): PrepareProfileForStorylineResponse {
  const requestedId = profileId?.trim() || DEFAULT_PROFILE_ID;
  const id = resolveExistingProfileId(requestedId);
  if (!id) {
    throw new Error(`Hermes profile 不存在：${requestedId}`);
  }
  const profileHome = getProfileHome(id);
  if (!fs.existsSync(profileHome)) {
    throw new Error(`Hermes profile 不存在：${id}`);
  }

  const changes: string[] = [];
  const sessionsDir = getSessionsDir(id);
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
    changes.push('创建 sessions 目录。');
  }

  const configPath = getConfigPath(id);
  const rawConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const configDoc = rawConfig.trim() ? YAML.parseDocument(rawConfig) : new YAML.Document({});
  if (configDoc.errors.length > 0) {
    throw new Error(`config.yaml 解析失败：${configPath}：${configDoc.errors[0]?.message ?? '未知 YAML 错误'}`);
  }

  if (configDoc.getIn(['session_reset', 'mode']) !== 'none') {
    configDoc.setIn(['session_reset', 'mode'], 'none');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, String(configDoc), 'utf8');
    changes.push('将 config.yaml 的 session_reset.mode 设置为 none。');
  }

  const soulPath = path.join(profileHome, 'SOUL.md');
  const existingSoul = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf8') : '';
  if (!existingSoul.trim()) {
    fs.writeFileSync(soulPath, buildDefaultSoul(id), 'utf8');
    changes.push('写入默认拟人化助手 SOUL.md。');
  } else if (!existingSoul.includes(BUBBLE_TOWN_SOUL_MARKER)) {
    fs.writeFileSync(soulPath, `${existingSoul.trimEnd()}\n${buildRuntimeSoulContract()}`, 'utf8');
    changes.push('向 SOUL.md 追加 Bubble Town ContextPack 优先规则。');
  }

  return {
    profileId: id,
    configPath,
    soulPath,
    changes,
  };
}

function ensureSessionResetNone(configPath: string, changes: string[]): void {
  const rawConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const configDoc = rawConfig.trim() ? YAML.parseDocument(rawConfig) : new YAML.Document({});
  if (configDoc.errors.length > 0) {
    throw new Error(`config.yaml 解析失败：${configPath}：${configDoc.errors[0]?.message ?? '未知 YAML 错误'}`);
  }

  if (configDoc.getIn(['session_reset', 'mode']) !== 'none') {
    configDoc.setIn(['session_reset', 'mode'], 'none');
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, String(configDoc), 'utf8');
  changes.push('重写 config.yaml，确保 session_reset.mode = none。');
}

function removePathIfExists(targetPath: string, description: string, changes: string[]): void {
  if (!fs.existsSync(targetPath)) {
    return;
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
  changes.push(description);
}

function removeFileIfExists(targetPath: string, description: string, changes: string[]): void {
  if (!fs.existsSync(targetPath)) {
    return;
  }
  fs.rmSync(targetPath, { force: true });
  changes.push(description);
}

export function resetProfileForStoryline(
  profileId: string,
  runtimeReset: ResetProfileRuntimeSummary,
  confirmationProfileName?: string,
): ResetProfileForStorylineResponse {
  const requestedId = profileId?.trim() || DEFAULT_PROFILE_ID;
  const id = resolveExistingProfileId(requestedId);
  if (!id) {
    throw new Error(`Hermes profile 不存在：${requestedId}`);
  }
  if (confirmationProfileName?.trim() !== id) {
    throw new Error(`确认输入不匹配，必须输入 profile 名称「${id}」才能执行重置。`);
  }

  const profileHome = getProfileHome(id);
  if (!fs.existsSync(profileHome)) {
    throw new Error(`Hermes profile 不存在：${id}`);
  }

  const changes: string[] = [];
  const sessionsDir = getSessionsDir(id);
  removePathIfExists(sessionsDir, '清空 Hermes sessions 目录。', changes);
  removePathIfExists(path.join(profileHome, 'logs'), '清空 Hermes logs 目录。', changes);
  removeFileIfExists(path.join(profileHome, 'state.db'), '删除 Hermes state.db。', changes);
  removeFileIfExists(path.join(profileHome, 'state.db-shm'), '删除 Hermes state.db-shm。', changes);
  removeFileIfExists(path.join(profileHome, 'state.db-wal'), '删除 Hermes state.db-wal。', changes);
  removeFileIfExists(path.join(profileHome, 'response_store.db'), '删除 Hermes response_store.db。', changes);
  removeFileIfExists(path.join(profileHome, 'response_store.db-shm'), '删除 Hermes response_store.db-shm。', changes);
  removeFileIfExists(path.join(profileHome, 'response_store.db-wal'), '删除 Hermes response_store.db-wal。', changes);

  fs.mkdirSync(sessionsDir, { recursive: true });
  changes.push('重建空的 sessions 目录。');

  const configPath = getConfigPath(id);
  ensureSessionResetNone(configPath, changes);

  const soulPath = path.join(profileHome, 'SOUL.md');
  fs.writeFileSync(soulPath, buildDefaultSoul(id), 'utf8');
  changes.push('重写 SOUL.md 为 Bubble Town 要求的初始助手设定。');

  return {
    profileId: id,
    configPath,
    soulPath,
    changes,
    runtimeReset,
  };
}
