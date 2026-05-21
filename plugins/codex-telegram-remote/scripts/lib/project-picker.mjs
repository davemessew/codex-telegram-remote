export function buildProjectKeyboard({
  projects,
  currentProjectId = "",
  page = 0,
  pageSize = 8,
  query = "",
}) {
  const filtered = filterProjects(projects, query);
  const safePageSize = Math.max(1, pageSize);
  const maxPage = Math.max(0, Math.ceil(filtered.length / safePageSize) - 1);
  const currentPage = clamp(page, 0, maxPage);
  const visible = filtered.slice(currentPage * safePageSize, (currentPage + 1) * safePageSize);
  const rows = visible.map((project) => [
    {
      text: project.id === currentProjectId ? `Current: ${project.name}` : project.name,
      callback_data: `select:${project.id}`,
    },
  ]);

  const navigation = [];
  if (currentPage > 0) {
    navigation.push({
      text: "Prev",
      callback_data: `page:${currentPage - 1}:${query}`,
    });
  }
  if (currentPage < maxPage) {
    navigation.push({
      text: "Next",
      callback_data: `page:${currentPage + 1}:${query}`,
    });
  }
  if (navigation.length > 0) {
    rows.push(navigation);
  }

  return {
    inline_keyboard: rows,
  };
}

export function formatProjectPickerText({
  projects,
  currentProjectId = "",
  page = 0,
  pageSize = 8,
  query = "",
}) {
  const filtered = filterProjects(projects, query);
  if (filtered.length === 0) {
    return query ? `No projects match "${query}".` : "No Codex projects are configured.";
  }

  const currentProject = projects.find((project) => project.id === currentProjectId);
  const pageCount = Math.max(1, Math.ceil(filtered.length / Math.max(1, pageSize)));
  const pageSuffix = pageCount > 1 ? ` Page ${Math.min(page + 1, pageCount)} of ${pageCount}.` : "";
  const currentSuffix = currentProject ? ` Current project: ${currentProject.name}.` : "";
  return `Select a project.${currentSuffix}${pageSuffix}`;
}

export function parseProjectCallback(data) {
  if (typeof data !== "string") {
    return null;
  }

  if (data.startsWith("select:")) {
    return {
      type: "select",
      projectId: data.slice("select:".length),
    };
  }

  if (data.startsWith("page:")) {
    const [, pageText, ...queryParts] = data.split(":");
    const page = Number(pageText);
    if (!Number.isInteger(page) || page < 0) {
      return null;
    }
    return {
      type: "page",
      page,
      query: queryParts.join(":"),
    };
  }

  return null;
}

export function filterProjects(projects, query = "") {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [...projects];
  }

  return projects.filter((project) => {
    return project.name.toLowerCase().includes(normalizedQuery)
      || project.path.toLowerCase().includes(normalizedQuery);
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number.isInteger(value) ? value : min, min), max);
}
