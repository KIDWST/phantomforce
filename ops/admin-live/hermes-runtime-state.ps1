function Test-HermesRuntimeAligned {
  param(
    [object]$Health,
    [string]$Commit,
    [string]$ContractsSourceHash
  )

  # A current commit alone does not prove a launcher verified generated contracts.
  return (
    $Commit -match '^[a-f0-9]{40}$' -and
    $ContractsSourceHash -match '^[a-f0-9]{64}$' -and
    [string]$Health.commit -eq $Commit -and
    [string]$Health.contractsSourceHash -eq $ContractsSourceHash
  )
}
