export function completionPercent(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return 0

  const completed = tasks.filter(task => task.status === 'done').length
  return Math.round((completed / tasks.length) * 100)
}

export function nextTaskId(tasks) {
  return Math.max(0, ...tasks.map(task => Number(task.id) || 0)) + 1
}
