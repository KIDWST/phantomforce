import { completionPercent, nextTaskId } from '/src/task-state.mjs'

const list = document.querySelector('#task-list')
const progress = document.querySelector('#progress')
const taskCount = document.querySelector('#task-count')
const health = document.querySelector('#health')
const updated = document.querySelector('#updated')
const addButton = document.querySelector('[data-action="add-task"]')

let tasks = []

function render() {
  list.replaceChildren(
    ...tasks.map(task => {
      const item = document.createElement('li')
      item.className = 'task-card'
      item.innerHTML = `<span class="status status--${task.status}">${task.status}</span><strong>${task.title}</strong>`
      return item
    })
  )
  progress.textContent = `${completionPercent(tasks)}%`
  taskCount.textContent = String(tasks.length)
  health.textContent = 'Healthy'
  updated.textContent = `Updated ${new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date())}`
}

addButton.addEventListener('click', () => {
  tasks = [...tasks, { id: nextTaskId(tasks), status: 'queued', title: 'New field task' }]
  render()
})

fetch('/api/tasks')
  .then(response => {
    if (!response.ok) throw new Error(`Task request failed: ${response.status}`)
    return response.json()
  })
  .then(payload => {
    tasks = payload.tasks
    render()
  })
  .catch(error => {
    health.textContent = 'Unavailable'
    list.innerHTML = `<li class="error">${error.message}</li>`
  })
