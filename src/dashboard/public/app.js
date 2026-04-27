async function fetchTasks() {
    try {
        // Since we are running locally, we'll try to find the project ID or just fetch all
        // For this demo, we'll hit a public endpoint we're about to create
        const response = await fetch('/api/public/tasks');
        const tasks = await response.json();
        renderBoard(tasks);
    } catch (error) {
        console.error('Failed to fetch tasks:', error);
    }
}

function renderBoard(tasks) {
    const columns = ['todo', 'in_progress', 'review', 'done'];
    let total = 0;
    let active = 0;

    columns.forEach(colId => {
        const column = document.getElementById(colId);
        const list = column.querySelector('.task-list');
        const countBadge = column.querySelector('.count');
        
        const filteredTasks = tasks.filter(t => t.status === colId);
        list.innerHTML = '';
        countBadge.textContent = filteredTasks.length;
        
        total += filteredTasks.length;
        if (colId !== 'done') active += filteredTasks.length;

        filteredTasks.forEach(task => {
            const card = document.createElement('div');
            card.className = 'task-card';
            card.innerHTML = `
                <span class="tag tag-${task.status}">${task.status.replace('_', ' ').toUpperCase()}</span>
                <h3>#${task.displayId} ${task.title}</h3>
                <div class="task-footer">
                    <div class="assignee">
                        <div class="avatar">${task.assigneeName ? task.assigneeName[0] : '?'}</div>
                        <span>${task.assigneeName || 'Unassigned'}</span>
                    </div>
                    <div class="date">${task.deadline || ''}</div>
                </div>
            `;
            list.appendChild(card);
        });
    });

    document.getElementById('total-count').textContent = total;
    document.getElementById('active-count').textContent = active;
}

// Polling for real-time-ish updates
fetchTasks();
setInterval(fetchTasks, 5000);
