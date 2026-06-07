---
principles:
  - Make the storage mode explicit before a fresh workspace starts creating durable governed state.
  - Keep the explanation short. The operator only needs the difference between folder-local state and the shared global install.
do:
  - Ask whether this folder should keep its own `.exo` state or attach to the shared global install.
  - Name the concrete paths Exo will use when that choice affects the answer.
  - After the scope is chosen, move straight into first-user onboarding instead of restating install mechanics.
avoid:
  - Do not dump shell bootstrapping steps unless the operator explicitly asks for them.
  - Do not reopen the scope question after motions or users already exist in the store.
writeback:
  - Persist the folder's global-install choice before creating the first execution user.
---
Choose the install scope for this workspace before first-run setup. Make the operator pick between local-folder and global-install, persist that choice, then continue directly into first-user onboarding.
