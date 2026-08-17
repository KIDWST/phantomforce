use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::{OsStr, OsString};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use zip::ZipArchive;

#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Storage::FileSystem::{REPLACEFILE_IGNORE_MERGE_ERRORS, ReplaceFileW};

const JOURNAL_VERSION: u8 = 1;
const MAX_HISTORY_TRANSACTIONS: usize = 250;
const MAX_IMPORT_ENTRIES: usize = 20_000;
const MAX_IMPORT_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_IMPORT_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ZIP_EXPANSION_RATIO: u64 = 2_000;

static OPERATION_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProjectKind {
    Panda3d,
    Godot,
    Unity,
    Unreal,
    Web,
    Assets,
    Mixed,
}

#[allow(dead_code)]
impl ProjectKind {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Panda3d => "Panda3D",
            Self::Godot => "Godot",
            Self::Unity => "Unity",
            Self::Unreal => "Unreal",
            Self::Web => "HTML",
            Self::Assets => "game assets",
            Self::Mixed => "mixed engine files",
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct HistoryState {
    pub(crate) can_undo: bool,
    pub(crate) can_redo: bool,
    pub(crate) undo_label: Option<String>,
    pub(crate) redo_label: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ImportSummary {
    pub(crate) added: usize,
    pub(crate) replaced: usize,
    pub(crate) skipped: usize,
    pub(crate) kind: ProjectKind,
    pub(crate) transaction_label: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct HistoryAction {
    pub(crate) label: String,
    pub(crate) recovered_conflicts: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct BlobRef {
    sha256: String,
    bytes: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct FileChange {
    relative_path: String,
    before: Option<BlobRef>,
    after: Option<BlobRef>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Transaction {
    id: String,
    label: String,
    created_unix_ms: u128,
    changes: Vec<FileChange>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Journal {
    version: u8,
    project_root: String,
    cursor: usize,
    transactions: Vec<Transaction>,
}

impl Journal {
    fn new(project_root: &Path) -> Self {
        Self {
            version: JOURNAL_VERSION,
            project_root: project_root.to_string_lossy().to_string(),
            cursor: 0,
            transactions: Vec::new(),
        }
    }
}

#[derive(Clone, Debug)]
struct PendingFile {
    relative_path: PathBuf,
    after: BlobRef,
}

#[derive(Debug, Default)]
struct ApplyResult {
    recovered_conflicts: usize,
}

#[derive(Serialize)]
struct RecoveryRecord {
    version: u8,
    created_unix_ms: u128,
    direction: String,
    files: Vec<RecoveryEntry>,
}

#[derive(Clone, Serialize)]
struct RecoveryEntry {
    relative_path: String,
    current: Option<BlobRef>,
    expected: Option<BlobRef>,
}

struct HistoryStore {
    project_root: PathBuf,
    canonical_root: PathBuf,
    history_identity: PathBuf,
    scoped_file_name: Option<OsString>,
    storage_root: PathBuf,
    objects_root: PathBuf,
    journal_path: PathBuf,
}

impl HistoryStore {
    fn open(project_root: &Path) -> Result<Self, String> {
        if !project_root.exists() {
            fs::create_dir_all(project_root).map_err(|error| {
                format!(
                    "Could not create project root {}: {error}",
                    project_root.display()
                )
            })?;
        }
        let history_identity = fs::canonicalize(project_root).map_err(|error| {
            format!(
                "Could not resolve project root {}: {error}",
                project_root.display()
            )
        })?;
        let (working_root, canonical_root, scoped_file_name) = if history_identity.is_file() {
            let parent = history_identity
                .parent()
                .ok_or_else(|| "Single-file project has no parent directory.".to_string())?
                .to_path_buf();
            (
                parent.clone(),
                fs::canonicalize(&parent).map_err(|error| {
                    format!("Could not resolve single-file project parent: {error}")
                })?,
                history_identity.file_name().map(OsStr::to_os_string),
            )
        } else if history_identity.is_dir() {
            (project_root.to_path_buf(), history_identity.clone(), None)
        } else {
            return Err(format!(
                "Project history requires a regular file or directory, got {}.",
                history_identity.display()
            ));
        };

        let project_key = hash_bytes(normalized_path_key(&history_identity).as_bytes());
        let storage_root = history_base().join(project_key);
        let objects_root = storage_root.join("objects");
        fs::create_dir_all(&objects_root)
            .map_err(|error| format!("Could not create PhantomPlay history storage: {error}"))?;
        let journal_path = storage_root.join("journal.json");
        Ok(Self {
            project_root: working_root,
            canonical_root,
            history_identity,
            scoped_file_name,
            storage_root,
            objects_root,
            journal_path,
        })
    }

    fn load_journal(&self) -> Result<Journal, String> {
        if !self.journal_path.exists() {
            return Ok(Journal::new(&self.history_identity));
        }
        let text = fs::read_to_string(&self.journal_path)
            .map_err(|error| format!("Could not read project history: {error}"))?;
        let journal: Journal = serde_json::from_str(&text)
            .map_err(|error| format!("Project history is not valid JSON: {error}"))?;
        if journal.version != JOURNAL_VERSION {
            return Err(format!(
                "Project history version {} is not supported by this PhantomPlay build.",
                journal.version
            ));
        }
        if normalized_path_key(Path::new(&journal.project_root))
            != normalized_path_key(&self.history_identity)
        {
            return Err("Project history belongs to a different project root.".to_string());
        }
        if journal.cursor > journal.transactions.len() {
            return Err("Project history cursor is outside the transaction list.".to_string());
        }
        Ok(journal)
    }

    fn save_journal(&self, journal: &Journal) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(journal)
            .map_err(|error| format!("Could not serialize project history: {error}"))?;
        let temporary = self.storage_root.join(format!(
            ".journal-{}.tmp",
            OPERATION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        {
            let mut file = File::create(&temporary)
                .map_err(|error| format!("Could not stage project history: {error}"))?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|error| format!("Could not persist project history: {error}"))?;
        }
        replace_file(&temporary, &self.journal_path)
            .map_err(|error| format!("Could not commit project history: {error}"))
    }

    fn store_file(&self, path: &Path) -> Result<BlobRef, String> {
        let metadata = fs::metadata(path)
            .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
        if !metadata.is_file() {
            return Err(format!("{} is not a regular file.", path.display()));
        }
        if metadata.len() > MAX_IMPORT_FILE_BYTES {
            return Err(format!(
                "{} is larger than PhantomPlay's 2 GB per-file import limit.",
                path.display()
            ));
        }
        let file = File::open(path)
            .map_err(|error| format!("Could not open {}: {error}", path.display()))?;
        self.store_reader(file, metadata.len())
    }

    fn store_reader<R: Read>(&self, mut reader: R, expected_bytes: u64) -> Result<BlobRef, String> {
        if expected_bytes > MAX_IMPORT_FILE_BYTES {
            return Err("An imported file exceeds the 2 GB per-file limit.".to_string());
        }
        let temporary = self.objects_root.join(format!(
            ".blob-{}-{}.tmp",
            std::process::id(),
            OPERATION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let mut output = File::create(&temporary)
            .map_err(|error| format!("Could not create a history object: {error}"))?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0_u8; 1024 * 1024];
        let mut total = 0_u64;
        loop {
            let count = reader
                .read(&mut buffer)
                .map_err(|error| format!("Could not read an imported file: {error}"))?;
            if count == 0 {
                break;
            }
            total = total
                .checked_add(count as u64)
                .ok_or_else(|| "Imported file size overflowed.".to_string())?;
            if total > MAX_IMPORT_FILE_BYTES {
                let _ = fs::remove_file(&temporary);
                return Err("An imported file exceeds the 2 GB per-file limit.".to_string());
            }
            hasher.update(&buffer[..count]);
            output
                .write_all(&buffer[..count])
                .map_err(|error| format!("Could not store an undo snapshot: {error}"))?;
        }
        output
            .sync_all()
            .map_err(|error| format!("Could not flush an undo snapshot: {error}"))?;
        if total != expected_bytes {
            let _ = fs::remove_file(&temporary);
            return Err(format!(
                "Imported file changed while it was being read (expected {expected_bytes} bytes, read {total})."
            ));
        }
        let sha256 = format_digest(hasher.finalize().as_slice());
        let object_path = self.objects_root.join(&sha256);
        if object_path.exists() {
            let _ = fs::remove_file(&temporary);
        } else {
            fs::rename(&temporary, &object_path)
                .map_err(|error| format!("Could not finalize an undo snapshot: {error}"))?;
        }
        Ok(BlobRef {
            sha256,
            bytes: total,
        })
    }

    fn object_path(&self, blob: &BlobRef) -> Result<PathBuf, String> {
        if blob.sha256.len() != 64 || !blob.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("Project history contains an invalid object identifier.".to_string());
        }
        let path = self.objects_root.join(&blob.sha256);
        let size = fs::metadata(&path)
            .map_err(|_| format!("Undo snapshot {} is missing.", blob.sha256))?
            .len();
        if size != blob.bytes {
            return Err(format!("Undo snapshot {} has the wrong size.", blob.sha256));
        }
        Ok(path)
    }

    fn destination(&self, relative: &str) -> Result<PathBuf, String> {
        let relative = safe_relative_path(Path::new(relative))?;
        if let Some(scoped_file_name) = self.scoped_file_name.as_ref()
            && relative.as_os_str() != scoped_file_name
        {
            return Err("A single-file game can only replace its own source file.".to_string());
        }
        let destination = self.project_root.join(&relative);
        validate_destination(&self.canonical_root, &destination)?;
        Ok(destination)
    }

    fn current_blob(&self, relative: &str) -> Result<Option<BlobRef>, String> {
        let destination = self.destination(relative)?;
        if !destination.exists() {
            return Ok(None);
        }
        if destination.is_dir() {
            return Err(format!(
                "Cannot replace directory {} with a file.",
                destination.display()
            ));
        }
        self.store_file(&destination).map(Some)
    }

    fn materialize(&self, relative: &str, blob: Option<&BlobRef>) -> Result<(), String> {
        let destination = self.destination(relative)?;
        match blob {
            Some(blob) => {
                let source = self.object_path(blob)?;
                let parent = destination
                    .parent()
                    .ok_or_else(|| "Imported file has no parent directory.".to_string())?;
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
                validate_destination(&self.canonical_root, &destination)?;
                let temporary = parent.join(format!(
                    ".phantomplay-{}-{}.tmp",
                    std::process::id(),
                    OPERATION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
                ));
                fs::copy(&source, &temporary).map_err(|error| {
                    format!("Could not stage {}: {error}", destination.display())
                })?;
                replace_file(&temporary, &destination).map_err(|error| {
                    format!("Could not replace {}: {error}", destination.display())
                })?;
            }
            None => {
                if destination.exists() {
                    if destination.is_dir() {
                        return Err(format!(
                            "Refusing to remove directory {} during undo.",
                            destination.display()
                        ));
                    }
                    fs::remove_file(&destination).map_err(|error| {
                        format!(
                            "Could not remove {} during undo: {error}",
                            destination.display()
                        )
                    })?;
                    remove_empty_parents(destination.parent(), &self.canonical_root);
                }
            }
        }
        Ok(())
    }

    fn apply_transaction(
        &self,
        transaction: &Transaction,
        undo: bool,
        recover_conflicts: bool,
    ) -> Result<ApplyResult, String> {
        let mut conflicts = Vec::<RecoveryEntry>::new();
        for change in &transaction.changes {
            let expected = if undo {
                change.after.as_ref()
            } else {
                change.before.as_ref()
            };
            let current = self.current_blob(&change.relative_path)?;
            if !same_blob(current.as_ref(), expected) {
                if !recover_conflicts {
                    return Err(format!(
                        "{} changed outside PhantomPlay during this action. It was left untouched.",
                        change.relative_path
                    ));
                }
                conflicts.push(RecoveryEntry {
                    relative_path: change.relative_path.clone(),
                    current,
                    expected: expected.cloned(),
                });
            }
        }
        if !conflicts.is_empty() {
            self.preserve_recovery(if undo { "undo" } else { "redo" }, &conflicts)?;
        }

        let mut applied = Vec::<usize>::new();
        for (index, change) in transaction.changes.iter().enumerate() {
            let desired = if undo {
                change.before.as_ref()
            } else {
                change.after.as_ref()
            };
            if let Err(error) = self.materialize(&change.relative_path, desired) {
                for applied_index in applied.into_iter().rev() {
                    let previous = &transaction.changes[applied_index];
                    let rollback = if undo {
                        previous.after.as_ref()
                    } else {
                        previous.before.as_ref()
                    };
                    let _ = self.materialize(&previous.relative_path, rollback);
                }
                return Err(error);
            }
            applied.push(index);
        }
        Ok(ApplyResult {
            recovered_conflicts: conflicts.len(),
        })
    }

    fn preserve_recovery(
        &self,
        direction: &str,
        conflicts: &[RecoveryEntry],
    ) -> Result<PathBuf, String> {
        let recovery_root = self.storage_root.join("recovery").join(operation_id());
        let files_root = recovery_root.join("files");
        fs::create_dir_all(&files_root)
            .map_err(|error| format!("Could not create recovery storage: {error}"))?;
        for conflict in conflicts {
            let Some(current) = conflict.current.as_ref() else {
                continue;
            };
            let relative = safe_relative_path(Path::new(&conflict.relative_path))?;
            let destination = files_root.join(relative);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Could not create recovery folder: {error}"))?;
            }
            fs::copy(self.object_path(current)?, &destination).map_err(|error| {
                format!(
                    "Could not preserve {} for recovery: {error}",
                    conflict.relative_path
                )
            })?;
        }
        let record = RecoveryRecord {
            version: JOURNAL_VERSION,
            created_unix_ms: unix_ms(),
            direction: direction.to_string(),
            files: conflicts.to_vec(),
        };
        fs::write(
            recovery_root.join("recovery.json"),
            serde_json::to_vec_pretty(&record)
                .map_err(|error| format!("Could not serialize recovery metadata: {error}"))?,
        )
        .map_err(|error| format!("Could not save recovery metadata: {error}"))?;
        Ok(recovery_root)
    }

    fn commit(&self, label: String, pending: Vec<PendingFile>) -> Result<ImportSummary, String> {
        if pending.is_empty() {
            return Err("The drop did not contain any importable game files.".to_string());
        }
        let kind = detect_project_kind(pending.iter().map(|item| item.relative_path.as_path()));
        let mut changes = Vec::with_capacity(pending.len());
        let mut added = 0;
        let mut replaced = 0;
        for item in pending {
            let relative_path = path_to_slashes(&item.relative_path);
            let before = self.current_blob(&relative_path)?;
            if same_blob(before.as_ref(), Some(&item.after)) {
                continue;
            }
            if before.is_some() {
                replaced += 1;
            } else {
                added += 1;
            }
            changes.push(FileChange {
                relative_path,
                before,
                after: Some(item.after),
            });
        }
        if changes.is_empty() {
            return Ok(ImportSummary {
                added: 0,
                replaced: 0,
                skipped: 0,
                kind,
                transaction_label: "No files changed".to_string(),
            });
        }
        changes.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        let transaction = Transaction {
            id: operation_id(),
            label: label.clone(),
            created_unix_ms: unix_ms(),
            changes,
        };
        let mut journal = self.load_journal()?;
        journal.transactions.truncate(journal.cursor);
        self.apply_transaction(&transaction, false, false)?;
        journal.transactions.push(transaction.clone());
        journal.cursor = journal.transactions.len();
        if journal.transactions.len() > MAX_HISTORY_TRANSACTIONS {
            let remove_count = journal.transactions.len() - MAX_HISTORY_TRANSACTIONS;
            journal.transactions.drain(0..remove_count);
            journal.cursor = journal.transactions.len();
        }
        if let Err(error) = self.save_journal(&journal) {
            let _ = self.apply_transaction(&transaction, true, false);
            return Err(error);
        }
        self.garbage_collect(&journal);
        Ok(ImportSummary {
            added,
            replaced,
            skipped: 0,
            kind,
            transaction_label: label,
        })
    }

    fn garbage_collect(&self, journal: &Journal) {
        let referenced = journal
            .transactions
            .iter()
            .flat_map(|transaction| transaction.changes.iter())
            .flat_map(|change| [change.before.as_ref(), change.after.as_ref()])
            .flatten()
            .map(|blob| blob.sha256.as_str())
            .collect::<BTreeSet<_>>();
        let Ok(entries) = fs::read_dir(&self.objects_root) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if name.starts_with('.') || referenced.contains(name) {
                continue;
            }
            let _ = fs::remove_file(entry.path());
        }
    }
}

#[allow(dead_code)]
pub(crate) fn project_library_dir() -> PathBuf {
    std::env::var_os("PHANTOMPLAY_PROJECTS_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(std::env::temp_dir)
                .join("PhantomPlay")
                .join("Projects")
        })
}

pub(crate) fn project_root_for_path(project_path: &Path, _is_directory: bool) -> PathBuf {
    project_path.to_path_buf()
}

pub(crate) fn history_state(project_root: &Path) -> Result<HistoryState, String> {
    let store = HistoryStore::open(project_root)?;
    let journal = store.load_journal()?;
    let undo = journal
        .cursor
        .checked_sub(1)
        .and_then(|index| journal.transactions.get(index));
    let redo = journal.transactions.get(journal.cursor);
    Ok(HistoryState {
        can_undo: undo.is_some(),
        can_redo: redo.is_some(),
        undo_label: undo.map(|transaction| transaction.label.clone()),
        redo_label: redo.map(|transaction| transaction.label.clone()),
    })
}

pub(crate) fn undo(project_root: &Path) -> Result<HistoryAction, String> {
    let store = HistoryStore::open(project_root)?;
    let mut journal = store.load_journal()?;
    let index = journal
        .cursor
        .checked_sub(1)
        .ok_or_else(|| "There is nothing to undo for this project.".to_string())?;
    let transaction = journal.transactions[index].clone();
    let applied = store.apply_transaction(&transaction, true, true)?;
    journal.cursor = index;
    if let Err(error) = store.save_journal(&journal) {
        let _ = store.apply_transaction(&transaction, false, false);
        return Err(error);
    }
    Ok(HistoryAction {
        label: transaction.label,
        recovered_conflicts: applied.recovered_conflicts,
    })
}

pub(crate) fn redo(project_root: &Path) -> Result<HistoryAction, String> {
    let store = HistoryStore::open(project_root)?;
    let mut journal = store.load_journal()?;
    let transaction = journal
        .transactions
        .get(journal.cursor)
        .cloned()
        .ok_or_else(|| "There is nothing to redo for this project.".to_string())?;
    let applied = store.apply_transaction(&transaction, false, true)?;
    journal.cursor += 1;
    if let Err(error) = store.save_journal(&journal) {
        let _ = store.apply_transaction(&transaction, true, false);
        return Err(error);
    }
    Ok(HistoryAction {
        label: transaction.label,
        recovered_conflicts: applied.recovered_conflicts,
    })
}

pub(crate) fn write_file(
    project_root: &Path,
    destination: &Path,
    bytes: &[u8],
    label: impl Into<String>,
) -> Result<ImportSummary, String> {
    if bytes.len() as u64 > MAX_IMPORT_FILE_BYTES {
        return Err("The edited file exceeds PhantomPlay's 2 GB per-file limit.".to_string());
    }
    let store = HistoryStore::open(project_root)?;
    let relative = destination.strip_prefix(&store.project_root).map_err(|_| {
        format!(
            "{} is outside the active project and cannot be edited.",
            destination.display()
        )
    })?;
    let relative = safe_relative_path(relative)?;
    let after = store.store_reader(bytes, bytes.len() as u64)?;
    store.commit(
        label.into(),
        vec![PendingFile {
            relative_path: relative,
            after,
        }],
    )
}

pub(crate) fn import_paths(
    project_root: &Path,
    sources: &[PathBuf],
    overwrite_target: Option<&Path>,
) -> Result<ImportSummary, String> {
    if sources.is_empty() {
        return Err("Drop one or more files, folders, or ZIP archives.".to_string());
    }
    let store = HistoryStore::open(project_root)?;
    if store.scoped_file_name.is_some() && overwrite_target.is_none() {
        return Err(
            "This is a single-file game. Drop one file directly on its file row to replace it."
                .to_string(),
        );
    }
    let mut skipped = 0;
    let pending = if let Some(target) = overwrite_target {
        if sources.len() != 1 || !sources[0].is_file() {
            return Err(
                "Drop exactly one file on a file row to replace it. Drop folders and ZIPs on the Project Files panel."
                    .to_string(),
            );
        }
        let relative = target
            .strip_prefix(&store.project_root)
            .map_err(|_| "The overwrite target is outside the active project.".to_string())?;
        let relative = safe_relative_path(relative)?;
        vec![PendingFile {
            relative_path: relative,
            after: store.store_file(&sources[0])?,
        }]
    } else {
        collect_sources(&store, sources, true, &mut skipped)?
    };
    let source_count = sources.len();
    let file_count = pending.len();
    let mut summary = store.commit(
        if let Some(target) = overwrite_target {
            format!("Replace {}", path_to_slashes(target))
        } else {
            format!(
                "Import {file_count} game file{} from {source_count} drop{}",
                if file_count == 1 { "" } else { "s" },
                if source_count == 1 { "" } else { "s" }
            )
        },
        pending,
    )?;
    summary.skipped = skipped;
    Ok(summary)
}

pub(crate) fn import_into_empty_project(
    project_root: &Path,
    source: &Path,
) -> Result<ImportSummary, String> {
    let store = HistoryStore::open(project_root)?;
    if store.scoped_file_name.is_some() {
        return Err("A project folder is required for folder or ZIP imports.".to_string());
    }
    let mut skipped = 0;
    let pending = collect_sources(&store, &[source.to_path_buf()], false, &mut skipped)?;
    let file_count = pending.len();
    let mut summary = store.commit(
        format!(
            "Import {file_count} game file{}",
            if file_count == 1 { "" } else { "s" }
        ),
        pending,
    )?;
    summary.skipped = skipped;
    Ok(summary)
}

#[allow(dead_code)]
pub(crate) fn import_project(sources: &[PathBuf]) -> Result<(PathBuf, ImportSummary), String> {
    if sources.len() != 1 {
        return Err(
            "Import one game folder or ZIP archive at a time into the Library.".to_string(),
        );
    }
    let source = &sources[0];
    if !source.is_dir()
        && source
            .extension()
            .and_then(|extension| extension.to_str())
            .is_none_or(|extension| !extension.eq_ignore_ascii_case("zip"))
    {
        return Err("Library imports must be a game folder or ZIP archive.".to_string());
    }
    let source_name = if source.is_dir() {
        source.file_name()
    } else {
        source.file_stem()
    }
    .and_then(|name| name.to_str())
    .unwrap_or("imported-project");
    let slug = project_slug(source_name);
    let fingerprint = source_fingerprint(source)?;
    let destination = import_destination(&slug, &fingerprint)?;
    let store = HistoryStore::open(&destination)?;
    let mut skipped = 0;
    let pending = collect_sources(&store, sources, false, &mut skipped)?;
    let kind = detect_project_kind(pending.iter().map(|item| item.relative_path.as_path()));
    if matches!(kind, ProjectKind::Assets | ProjectKind::Mixed) {
        let journal = store.load_journal()?;
        store.garbage_collect(&journal);
        return Err(
            "The archive does not have one clear game root. Add project.godot, a Panda manifest, one .uproject, Unity ProjectSettings, or index.html."
                .to_string(),
        );
    }
    let marker = serde_json::json!({
        "version": 1,
        "project_id": destination.file_name().and_then(|name| name.to_str()).unwrap_or("imported-project"),
        "kind": kind.label(),
        "source_name": source_name,
        "source_fingerprint": fingerprint,
    });
    let marker_path = destination.join(".phantomplay-project.json");
    let previous_marker = fs::read(&marker_path).ok();
    let marker_bytes = serde_json::to_vec_pretty(&marker)
        .map_err(|error| format!("Could not serialize project metadata: {error}"))?;
    write_marker(&marker_path, Some(&marker_bytes))?;
    let file_count = pending.len();
    let result = store.commit(
        format!(
            "Import {file_count} project file{} from {source_name}",
            if file_count == 1 { "" } else { "s" }
        ),
        pending,
    );
    let mut summary = match result {
        Ok(summary) => summary,
        Err(error) => {
            let restore_result = write_marker(&marker_path, previous_marker.as_deref());
            return match restore_result {
                Ok(()) => Err(error),
                Err(restore_error) => Err(format!(
                    "{error} Project metadata recovery also failed: {restore_error}"
                )),
            };
        }
    };
    summary.skipped = skipped;
    Ok((destination, summary))
}

#[allow(dead_code)]
fn source_fingerprint(source: &Path) -> Result<String, String> {
    let canonical = fs::canonicalize(source)
        .map_err(|error| format!("Could not resolve {}: {error}", source.display()))?;
    Ok(hash_bytes(normalized_path_key(&canonical).as_bytes()))
}

#[allow(dead_code)]
fn import_destination(slug: &str, fingerprint: &str) -> Result<PathBuf, String> {
    let library = project_library_dir();
    fs::create_dir_all(&library)
        .map_err(|error| format!("Could not create the PhantomPlay project library: {error}"))?;
    let short_fingerprint = &fingerprint[..fingerprint.len().min(8)];
    for attempt in 0..1_000_u16 {
        let name = if attempt == 0 {
            slug.to_string()
        } else if attempt == 1 {
            format!("{slug}-{short_fingerprint}")
        } else {
            format!("{slug}-{short_fingerprint}-{attempt}")
        };
        let candidate = library.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
        let marker = fs::read_to_string(candidate.join(".phantomplay-project.json"))
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());
        if marker
            .as_ref()
            .and_then(|value| value.get("source_fingerprint"))
            .and_then(|value| value.as_str())
            == Some(fingerprint)
        {
            return Ok(candidate);
        }
    }
    Err("Could not allocate a unique project identity for this import.".to_string())
}

#[allow(dead_code)]
fn write_marker(path: &Path, bytes: Option<&[u8]>) -> Result<(), String> {
    let Some(bytes) = bytes else {
        if path.exists() {
            fs::remove_file(path)
                .map_err(|error| format!("Could not restore project metadata: {error}"))?;
        }
        return Ok(());
    };
    let parent = path
        .parent()
        .ok_or_else(|| "Project metadata has no parent directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create project metadata folder: {error}"))?;
    let temporary = parent.join(format!(
        ".phantomplay-project-{}-{}.tmp",
        std::process::id(),
        OPERATION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    {
        let mut file = File::create(&temporary)
            .map_err(|error| format!("Could not stage project metadata: {error}"))?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("Could not flush project metadata: {error}"))?;
    }
    replace_file(&temporary, path)
        .map_err(|error| format!("Could not save project metadata: {error}"))
}

fn validate_case_collisions<'a>(paths: impl Iterator<Item = &'a PathBuf>) -> Result<(), String> {
    let mut seen = BTreeMap::<String, String>::new();
    for path in paths {
        let display = path_to_slashes(path);
        let collision_key = display.to_lowercase();
        if let Some(previous) = seen.insert(collision_key, display.clone())
            && previous != display
        {
            return Err(format!(
                "The drop contains paths that collide on Windows: {previous} and {display}."
            ));
        }
    }
    Ok(())
}

fn collect_sources(
    store: &HistoryStore,
    sources: &[PathBuf],
    preserve_single_directory_root: bool,
    skipped: &mut usize,
) -> Result<Vec<PendingFile>, String> {
    let mut pending = BTreeMap::<PathBuf, BlobRef>::new();
    let mut total_bytes = 0_u64;
    for source in sources {
        let metadata = fs::symlink_metadata(source)
            .map_err(|error| format!("Could not inspect {}: {error}", source.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Symlink drops are not allowed: {}",
                source.display()
            ));
        }
        if metadata.is_dir() {
            collect_directory(
                store,
                source,
                source,
                preserve_single_directory_root || sources.len() > 1,
                &mut pending,
                &mut total_bytes,
                skipped,
            )?;
        } else if source
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
        {
            collect_zip(store, source, &mut pending, &mut total_bytes, skipped)?;
        } else if metadata.is_file() {
            add_pending_file(
                store,
                source,
                PathBuf::from(
                    source
                        .file_name()
                        .ok_or_else(|| "Dropped file has no name.".to_string())?,
                ),
                &mut pending,
                &mut total_bytes,
            )?;
        }
    }
    validate_case_collisions(pending.keys())?;
    Ok(pending
        .into_iter()
        .map(|(relative_path, after)| PendingFile {
            relative_path,
            after,
        })
        .collect())
}

#[allow(clippy::too_many_arguments)]
fn collect_directory(
    store: &HistoryStore,
    root: &Path,
    current: &Path,
    keep_root_name: bool,
    pending: &mut BTreeMap<PathBuf, BlobRef>,
    total_bytes: &mut u64,
    skipped: &mut usize,
) -> Result<(), String> {
    let mut entries = fs::read_dir(current)
        .map_err(|error| format!("Could not read {}: {error}", current.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read {}: {error}", current.display()))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        if pending.len() >= MAX_IMPORT_ENTRIES {
            return Err("The drop exceeds PhantomPlay's 20,000-file import limit.".to_string());
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Symlinks are not allowed in imports: {}",
                path.display()
            ));
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| "Imported folder path changed while scanning.".to_string())?;
        let relative = if keep_root_name {
            PathBuf::from(root.file_name().unwrap_or_default()).join(relative)
        } else {
            relative.to_path_buf()
        };
        if should_skip(&relative) {
            *skipped += 1;
            continue;
        }
        if metadata.is_dir() {
            collect_directory(
                store,
                root,
                &path,
                keep_root_name,
                pending,
                total_bytes,
                skipped,
            )?;
        } else if metadata.is_file() {
            add_pending_file(store, &path, relative, pending, total_bytes)?;
        }
    }
    Ok(())
}

fn collect_zip(
    store: &HistoryStore,
    source: &Path,
    pending: &mut BTreeMap<PathBuf, BlobRef>,
    total_bytes: &mut u64,
    skipped: &mut usize,
) -> Result<(), String> {
    let file = File::open(source)
        .map_err(|error| format!("Could not open ZIP {}: {error}", source.display()))?;
    let mut archive = ZipArchive::new(file).map_err(|error| {
        format!(
            "{} is not a readable ZIP archive: {error}",
            source.display()
        )
    })?;
    if archive.len() > MAX_IMPORT_ENTRIES {
        return Err("The ZIP exceeds PhantomPlay's 20,000-entry import limit.".to_string());
    }
    let mut plans = Vec::<(usize, PathBuf, u64)>::new();
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("Could not inspect ZIP entry {index}: {error}"))?;
        if entry.is_symlink() {
            return Err(format!("ZIP symlinks are not allowed: {}", entry.name()));
        }
        if entry.is_dir() {
            continue;
        }
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| format!("ZIP contains an unsafe path: {}", entry.name()))?;
        let relative = safe_relative_path(&relative)?;
        if should_skip(&relative) {
            *skipped += 1;
            continue;
        }
        if entry.size() > MAX_IMPORT_FILE_BYTES {
            return Err(format!(
                "ZIP entry {} exceeds the 2 GB per-file limit.",
                entry.name()
            ));
        }
        if entry.size() > 0
            && (entry.compressed_size() == 0
                || entry.size() / entry.compressed_size().max(1) > MAX_ZIP_EXPANSION_RATIO)
        {
            return Err(format!(
                "ZIP entry {} has an unsafe expansion ratio.",
                entry.name()
            ));
        }
        plans.push((index, relative, entry.size()));
    }
    let common_root = common_wrapping_directory(plans.iter().map(|(_, path, _)| path.as_path()))
        .filter(|root| {
            let stripped = plans
                .iter()
                .filter_map(|(_, path, _)| strip_first_component(path, root).ok())
                .collect::<Vec<_>>();
            !matches!(
                detect_project_kind(stripped.iter().map(PathBuf::as_path)),
                ProjectKind::Assets | ProjectKind::Mixed
            )
        });
    for (index, relative, expected_bytes) in plans {
        let relative = if let Some(root) = common_root.as_ref() {
            strip_first_component(&relative, root)?
        } else {
            relative
        };
        if relative.as_os_str().is_empty() {
            continue;
        }
        *total_bytes = total_bytes
            .checked_add(expected_bytes)
            .ok_or_else(|| "ZIP import size overflowed.".to_string())?;
        if *total_bytes > MAX_IMPORT_BYTES {
            return Err("The drop exceeds PhantomPlay's 8 GB transaction limit.".to_string());
        }
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("Could not read ZIP entry {index}: {error}"))?;
        let blob = store.store_reader(entry, expected_bytes)?;
        if pending.insert(relative.clone(), blob).is_some() {
            return Err(format!(
                "The drop contains more than one file for {}.",
                relative.display()
            ));
        }
    }
    Ok(())
}

fn add_pending_file(
    store: &HistoryStore,
    source: &Path,
    relative: PathBuf,
    pending: &mut BTreeMap<PathBuf, BlobRef>,
    total_bytes: &mut u64,
) -> Result<(), String> {
    let relative = safe_relative_path(&relative)?;
    if pending.len() >= MAX_IMPORT_ENTRIES {
        return Err("The drop exceeds PhantomPlay's 20,000-file import limit.".to_string());
    }
    let bytes = fs::metadata(source)
        .map_err(|error| format!("Could not inspect {}: {error}", source.display()))?
        .len();
    *total_bytes = total_bytes
        .checked_add(bytes)
        .ok_or_else(|| "Import size overflowed.".to_string())?;
    if *total_bytes > MAX_IMPORT_BYTES {
        return Err("The drop exceeds PhantomPlay's 8 GB transaction limit.".to_string());
    }
    let blob = store.store_file(source)?;
    if pending.insert(relative.clone(), blob).is_some() {
        return Err(format!(
            "The drop contains more than one file for {}.",
            relative.display()
        ));
    }
    Ok(())
}

fn detect_project_kind<'a>(paths: impl Iterator<Item = &'a Path>) -> ProjectKind {
    let paths = paths
        .map(|path| path_to_slashes(path).to_ascii_lowercase())
        .collect::<Vec<_>>();
    let mut godot = false;
    let mut unity = false;
    let mut unreal = false;
    let mut web = false;
    for normalized in &paths {
        godot |= normalized == "project.godot";
        unity |= normalized == "projectsettings/projectversion.txt";
        unreal |= !normalized.contains('/') && normalized.ends_with(".uproject");
        web |= normalized == "index.html";
    }
    let panda = paths.iter().any(|path| path == "manifest.json")
        && paths.iter().any(|path| path == "app.py")
        && paths.iter().any(|path| path == "__init__.py");
    let engine_count = [godot, unity, unreal, panda, web]
        .into_iter()
        .filter(|found| *found)
        .count();
    if engine_count > 1 {
        ProjectKind::Mixed
    } else if godot {
        ProjectKind::Godot
    } else if unity {
        ProjectKind::Unity
    } else if unreal {
        ProjectKind::Unreal
    } else if panda {
        ProjectKind::Panda3d
    } else if web {
        ProjectKind::Web
    } else {
        ProjectKind::Assets
    }
}

fn history_base() -> PathBuf {
    std::env::var_os("PHANTOMPLAY_HISTORY_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(std::env::temp_dir)
                .join("PhantomPlay")
                .join("History")
        })
}

fn should_skip(path: &Path) -> bool {
    if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.eq_ignore_ascii_case(".DS_Store")
                || name.eq_ignore_ascii_case(".phantomplay-project.json")
                || name.eq_ignore_ascii_case("export_credentials.cfg")
                || name.ends_with(".pyc")
                || name.ends_with(".pyo")
        })
    {
        return true;
    }
    let components = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(name) => Some(name.to_string_lossy()),
            _ => None,
        })
        .collect::<Vec<_>>();
    if components.iter().any(|name| {
        [".git", ".godot", "__MACOSX", "__pycache__", "node_modules"]
            .iter()
            .any(|blocked| name.eq_ignore_ascii_case(blocked))
    }) {
        return true;
    }
    components.first().is_some_and(|name| {
        [
            "target",
            "Library",
            "Temp",
            "Logs",
            "obj",
            "DerivedDataCache",
            "Intermediate",
            "Saved",
            "Binaries",
        ]
        .iter()
        .any(|blocked| name.eq_ignore_ascii_case(blocked))
    })
}

fn safe_relative_path(path: &Path) -> Result<PathBuf, String> {
    let mut safe = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                let value = part.to_string_lossy();
                let trimmed = value.trim_end_matches([' ', '.']);
                let device_stem = trimmed
                    .split('.')
                    .next()
                    .unwrap_or_default()
                    .to_ascii_uppercase();
                let reserved_device = matches!(device_stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                    || (device_stem.len() == 4
                        && (device_stem.starts_with("COM") || device_stem.starts_with("LPT"))
                        && matches!(device_stem.as_bytes()[3], b'1'..=b'9'));
                if value.contains(':')
                    || value.contains('\0')
                    || trimmed.len() != value.len()
                    || reserved_device
                {
                    return Err(format!("Unsafe project path component: {value}"));
                }
                safe.push(part);
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("Unsafe project path: {}", path.display()));
            }
        }
    }
    if safe.as_os_str().is_empty() {
        return Err("Imported file has an empty destination path.".to_string());
    }
    Ok(safe)
}

fn validate_destination(canonical_root: &Path, destination: &Path) -> Result<(), String> {
    let mut ancestor = destination;
    while !ancestor.exists() {
        ancestor = ancestor
            .parent()
            .ok_or_else(|| "Imported path has no existing parent.".to_string())?;
    }
    let canonical_ancestor = fs::canonicalize(ancestor).map_err(|error| {
        format!(
            "Could not validate destination {}: {error}",
            destination.display()
        )
    })?;
    if !canonical_ancestor.starts_with(canonical_root) {
        return Err(format!(
            "Refusing to write outside the project root: {}",
            destination.display()
        ));
    }
    if destination.exists() {
        let metadata = fs::symlink_metadata(destination).map_err(|error| {
            format!(
                "Could not inspect destination {}: {error}",
                destination.display()
            )
        })?;
        if metadata.is_dir() {
            return Err(format!(
                "{} is a directory, not a file.",
                destination.display()
            ));
        }
    }
    Ok(())
}

fn common_wrapping_directory<'a>(paths: impl Iterator<Item = &'a Path>) -> Option<OsString> {
    let paths = paths.collect::<Vec<_>>();
    let first = paths.first()?.components().next()?;
    let Component::Normal(first) = first else {
        return None;
    };
    if paths.iter().all(|path| {
        let mut components = path.components();
        matches!(components.next(), Some(Component::Normal(value)) if value == first)
            && components.next().is_some()
    }) {
        Some(first.to_os_string())
    } else {
        None
    }
}

fn strip_first_component(path: &Path, expected: &OsString) -> Result<PathBuf, String> {
    let mut components = path.components();
    match components.next() {
        Some(Component::Normal(value)) if value == expected => {
            Ok(components.as_path().to_path_buf())
        }
        _ => Err("ZIP wrapping directory changed while importing.".to_string()),
    }
}

fn replace_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    if !destination.exists() {
        return fs::rename(temporary, destination);
    }
    #[cfg(target_os = "windows")]
    {
        let destination_wide = destination
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let temporary_wide = temporary
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let replaced = unsafe {
            ReplaceFileW(
                destination_wide.as_ptr(),
                temporary_wide.as_ptr(),
                std::ptr::null(),
                REPLACEFILE_IGNORE_MERGE_ERRORS,
                std::ptr::null(),
                std::ptr::null(),
            )
        };
        if replaced == 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        fs::rename(temporary, destination)
    }
}

fn remove_empty_parents(mut parent: Option<&Path>, root: &Path) {
    while let Some(directory) = parent {
        let Ok(canonical) = fs::canonicalize(directory) else {
            break;
        };
        if canonical == root || !canonical.starts_with(root) {
            break;
        }
        match fs::remove_dir(directory) {
            Ok(()) => parent = directory.parent(),
            Err(_) => break,
        }
    }
}

fn same_blob(left: Option<&BlobRef>, right: Option<&BlobRef>) -> bool {
    match (left, right) {
        (None, None) => true,
        (Some(left), Some(right)) => left.sha256 == right.sha256 && left.bytes == right.bytes,
        _ => false,
    }
}

fn operation_id() -> String {
    format!(
        "{}-{}-{}",
        unix_ms(),
        std::process::id(),
        OPERATION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

fn unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn normalized_path_key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        value.to_ascii_lowercase()
    } else {
        value
    }
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format_digest(hasher.finalize().as_slice())
}

fn format_digest(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut output, "{byte:02x}");
    }
    output
}

fn path_to_slashes(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[allow(dead_code)]
fn project_slug(name: &str) -> String {
    let mut slug = String::new();
    let mut separator = false;
    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            if separator && !slug.is_empty() {
                slug.push('-');
            }
            slug.push(character.to_ascii_lowercase());
            separator = false;
        } else {
            separator = true;
        }
    }
    if slug.is_empty() {
        "imported-project".to_string()
    } else {
        slug
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use zip::write::SimpleFileOptions;

    fn fixture() -> (TempDir, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir_all(&project).unwrap();
        // Tests use a process-unique explicit history root and do not mutate global env.
        (temp, project)
    }

    fn history_for(project: &Path, base: &Path) -> HistoryStore {
        let canonical_root = fs::canonicalize(project).unwrap();
        let project_key = hash_bytes(normalized_path_key(&canonical_root).as_bytes());
        let storage_root = base.join(project_key);
        let objects_root = storage_root.join("objects");
        fs::create_dir_all(&objects_root).unwrap();
        HistoryStore {
            project_root: project.to_path_buf(),
            canonical_root: canonical_root.clone(),
            history_identity: canonical_root,
            scoped_file_name: None,
            journal_path: storage_root.join("journal.json"),
            storage_root,
            objects_root,
        }
    }

    fn commit_bytes(
        store: &HistoryStore,
        relative: &str,
        bytes: &[u8],
        label: &str,
    ) -> ImportSummary {
        let blob = store.store_reader(bytes, bytes.len() as u64).unwrap();
        store
            .commit(
                label.to_string(),
                vec![PendingFile {
                    relative_path: PathBuf::from(relative),
                    after: blob,
                }],
            )
            .unwrap()
    }

    #[test]
    fn overwrite_undo_and_redo_survive_journal_reload() {
        let (temp, project) = fixture();
        let history = temp.path().join("history");
        let store = history_for(&project, &history);
        fs::write(project.join("game.gd"), b"old").unwrap();
        let summary = commit_bytes(&store, "game.gd", b"new", "Replace game.gd");
        assert_eq!(summary.replaced, 1);
        assert_eq!(fs::read(project.join("game.gd")).unwrap(), b"new");

        let mut journal = store.load_journal().unwrap();
        let transaction = journal.transactions[0].clone();
        store.apply_transaction(&transaction, true, false).unwrap();
        journal.cursor = 0;
        store.save_journal(&journal).unwrap();
        assert_eq!(fs::read(project.join("game.gd")).unwrap(), b"old");

        let reloaded = store.load_journal().unwrap();
        store
            .apply_transaction(&reloaded.transactions[0], false, false)
            .unwrap();
        assert_eq!(fs::read(project.join("game.gd")).unwrap(), b"new");
    }

    #[test]
    fn undo_refuses_to_destroy_external_edits() {
        let (temp, project) = fixture();
        let store = history_for(&project, &temp.path().join("history"));
        commit_bytes(&store, "scene.tscn", b"version one", "Create scene");
        fs::write(project.join("scene.tscn"), b"external edit").unwrap();
        let journal = store.load_journal().unwrap();
        let error = store
            .apply_transaction(&journal.transactions[0], true, false)
            .unwrap_err();
        assert!(error.contains("changed outside PhantomPlay"));
        assert_eq!(
            fs::read(project.join("scene.tscn")).unwrap(),
            b"external edit"
        );
    }

    #[test]
    fn recoverable_undo_preserves_external_bytes_before_continuing() {
        let (temp, project) = fixture();
        let store = history_for(&project, &temp.path().join("history"));
        fs::write(project.join("scene.tscn"), b"original").unwrap();
        commit_bytes(&store, "scene.tscn", b"phantomplay edit", "Edit scene");
        fs::write(project.join("scene.tscn"), b"external edit").unwrap();
        let journal = store.load_journal().unwrap();
        let applied = store
            .apply_transaction(&journal.transactions[0], true, true)
            .unwrap();
        assert_eq!(applied.recovered_conflicts, 1);
        assert_eq!(fs::read(project.join("scene.tscn")).unwrap(), b"original");
        let recovery_files = fs::read_dir(store.storage_root.join("recovery"))
            .unwrap()
            .flatten()
            .map(|entry| entry.path().join("files").join("scene.tscn"))
            .collect::<Vec<_>>();
        assert!(
            recovery_files
                .iter()
                .any(|path| { fs::read(path).ok().as_deref() == Some(&b"external edit"[..]) })
        );
    }

    #[test]
    fn new_action_after_undo_discards_redo_branch() {
        let (temp, project) = fixture();
        let store = history_for(&project, &temp.path().join("history"));
        commit_bytes(&store, "state.txt", b"one", "One");
        commit_bytes(&store, "state.txt", b"two", "Two");
        let mut journal = store.load_journal().unwrap();
        let transaction = journal.transactions[1].clone();
        store.apply_transaction(&transaction, true, false).unwrap();
        journal.cursor = 1;
        store.save_journal(&journal).unwrap();
        commit_bytes(&store, "state.txt", b"three", "Three");
        let journal = store.load_journal().unwrap();
        assert_eq!(journal.transactions.len(), 2);
        assert_eq!(journal.transactions[1].label, "Three");
        assert_eq!(journal.cursor, 2);
    }

    #[test]
    fn zip_strips_one_wrapper_and_rejects_zip_slip() {
        let (temp, project) = fixture();
        let history = temp.path().join("history");
        let store = history_for(&project, &history);
        let good_zip = temp.path().join("good.zip");
        {
            let file = File::create(&good_zip).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            zip.start_file("my-game/project.godot", SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"[application]").unwrap();
            zip.start_file("my-game/scenes/main.tscn", SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"scene").unwrap();
            zip.finish().unwrap();
        }
        let mut skipped = 0;
        let pending = collect_sources(&store, &[good_zip], false, &mut skipped).unwrap();
        assert!(
            pending
                .iter()
                .any(|item| item.relative_path == Path::new("project.godot"))
        );
        assert!(
            pending
                .iter()
                .any(|item| item.relative_path == Path::new("scenes/main.tscn"))
        );

        let bad_zip = temp.path().join("bad.zip");
        {
            let file = File::create(&bad_zip).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            zip.start_file("../escape.txt", SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"escape").unwrap();
            zip.finish().unwrap();
        }
        let error = collect_sources(&store, &[bad_zip], false, &mut 0).unwrap_err();
        assert!(error.contains("unsafe path") || error.contains("Unsafe project path"));
        assert!(!temp.path().join("escape.txt").exists());
    }

    #[test]
    fn generated_engine_caches_are_skipped() {
        assert!(should_skip(Path::new(".godot/imported/mesh.bin")));
        assert!(should_skip(Path::new("Library/ArtifactDB")));
        assert!(should_skip(Path::new("DerivedDataCache/cache.bin")));
        assert!(should_skip(Path::new(".godot/export_credentials.cfg")));
        assert!(!should_skip(Path::new("docs/Library/reference.txt")));
        assert!(!should_skip(Path::new("assets/player.glb")));
        assert!(!should_skip(Path::new("sprite.png.import")));
    }

    #[test]
    fn root_engine_marker_wins_over_nested_web_documentation() {
        let paths = [
            PathBuf::from("project.godot"),
            PathBuf::from("docs/index.html"),
            PathBuf::from("scenes/main.tscn"),
        ];
        assert_eq!(
            detect_project_kind(paths.iter().map(PathBuf::as_path)),
            ProjectKind::Godot
        );
    }

    #[test]
    fn windows_case_collisions_are_rejected_before_materialization() {
        let paths = [
            PathBuf::from("Scenes/Main.gd"),
            PathBuf::from("scenes/main.gd"),
        ];
        let error = validate_case_collisions(paths.iter()).unwrap_err();
        assert!(error.contains("collide on Windows"));
    }

    #[test]
    fn a_single_asset_folder_keeps_its_root_name_when_merged() {
        let (temp, project) = fixture();
        let store = history_for(&project, &temp.path().join("history"));
        let assets = temp.path().join("Assets");
        fs::create_dir_all(&assets).unwrap();
        fs::write(assets.join("player.glb"), b"model").unwrap();
        let pending = collect_sources(&store, &[assets], true, &mut 0).unwrap();
        assert_eq!(pending[0].relative_path, Path::new("Assets/player.glb"));
    }

    #[test]
    fn asset_archives_keep_their_meaningful_folder_name() {
        let (temp, project) = fixture();
        let store = history_for(&project, &temp.path().join("history"));
        let archive_path = temp.path().join("assets.zip");
        {
            let file = File::create(&archive_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            zip.start_file("assets/player.glb", SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"model").unwrap();
            zip.finish().unwrap();
        }
        let pending = collect_sources(&store, &[archive_path], false, &mut 0).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].relative_path, Path::new("assets/player.glb"));
    }

    #[test]
    fn unsafe_windows_names_and_alternate_streams_are_rejected() {
        assert!(safe_relative_path(Path::new("assets/save.txt:payload")).is_err());
        assert!(safe_relative_path(Path::new("CON.txt")).is_err());
        assert!(safe_relative_path(Path::new("assets/trailing. ")).is_err());
        assert!(safe_relative_path(Path::new("assets/normal.txt")).is_ok());
    }

    #[test]
    fn single_file_history_cannot_write_a_sibling_game() {
        let temp = tempfile::tempdir().unwrap();
        let game = temp.path().join("one.html");
        fs::write(&game, b"one").unwrap();
        let canonical_file = fs::canonicalize(&game).unwrap();
        let canonical_root = fs::canonicalize(temp.path()).unwrap();
        let storage_root = temp.path().join("history");
        let objects_root = storage_root.join("objects");
        fs::create_dir_all(&objects_root).unwrap();
        let store = HistoryStore {
            project_root: temp.path().to_path_buf(),
            canonical_root,
            history_identity: canonical_file.clone(),
            scoped_file_name: canonical_file.file_name().map(OsStr::to_os_string),
            journal_path: storage_root.join("journal.json"),
            storage_root,
            objects_root,
        };
        commit_bytes(&store, "one.html", b"changed", "Save one.html");
        let blob = store.store_reader(&b"bad"[..], 3).unwrap();
        let error = store
            .commit(
                "Write sibling".to_string(),
                vec![PendingFile {
                    relative_path: PathBuf::from("two.html"),
                    after: blob,
                }],
            )
            .unwrap_err();
        assert!(error.contains("single-file game"));
        assert!(!temp.path().join("two.html").exists());
    }
}
