"use client";

import { useMemo, useState } from "react";
import {
  createAuditTimeline,
  filterAuditEvents,
  getSelectedAuditEvent,
  labelForEntityType,
  type AuditEntityType
} from "./domain";

export function AuditTimeline() {
  const [timeline, setTimeline] = useState(() => createAuditTimeline());
  const filteredEvents = useMemo(() => filterAuditEvents(timeline.events, timeline.filters), [timeline.events, timeline.filters]);
  const selectedEvent = getSelectedAuditEvent(
    filteredEvents,
    filteredEvents.some((event) => event.id === timeline.selectedEventId) ? timeline.selectedEventId : null
  );

  function updateFilter(name: "actorUserId" | "projectId", value: string): void;
  function updateFilter(name: "entityType", value: AuditEntityType | "all"): void;
  function updateFilter(name: "actorUserId" | "entityType" | "projectId", value: AuditEntityType | "all" | string) {
    setTimeline((current) => ({
      ...current,
      filters: {
        ...current.filters,
        [name]: value
      },
      selectedEventId: null
    }));
  }

  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2>Audit filters</h2>
          <span>{filteredEvents.length} events</span>
        </div>
        <form aria-label="Audit filters" className="audit-filters">
          <label>
            <span>Project</span>
            <select
              aria-label="Project"
              onChange={(event) => updateFilter("projectId", event.target.value)}
              value={timeline.filters.projectId}
            >
              <option value="all">All projects</option>
              {timeline.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Entity</span>
            <select
              aria-label="Entity"
              onChange={(event) => updateFilter("entityType", event.target.value as AuditEntityType | "all")}
              value={timeline.filters.entityType}
            >
              <option value="all">All entities</option>
              {entityTypeOptions.map((entityType) => (
                <option key={entityType} value={entityType}>
                  {labelForEntityType(entityType)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>User</span>
            <select
              aria-label="User"
              onChange={(event) => updateFilter("actorUserId", event.target.value)}
              value={timeline.filters.actorUserId}
            >
              <option value="all">All actors</option>
              {timeline.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
        </form>
      </section>

      <div className="audit-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Timeline</h2>
            <span>append only</span>
          </div>
          {filteredEvents.length > 0 ? (
            <ol className="audit-list" data-testid="audit-timeline">
              {filteredEvents.map((event) => (
                <li key={event.id}>
                  <button
                    className={event.id === selectedEvent?.id ? "audit-event selected-row" : "audit-event"}
                    onClick={() => setTimeline((current) => ({ ...current, selectedEventId: event.id }))}
                    type="button"
                  >
                    <strong>{event.eventType}</strong>
                    <span>
                      {event.projectName ?? "Organization"} · {event.actor.userName ?? event.actor.type}
                    </span>
                    <small>
                      {labelForEntityType(event.entityType)}
                      {event.entityId ? ` · ${event.entityId}` : ""}
                    </small>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <div className="empty-state" data-testid="audit-empty">
              No audit events match these filters.
            </div>
          )}
        </section>

        <aside className="panel audit-detail" data-testid="audit-detail">
          {selectedEvent ? (
            <>
              <div className="panel-heading">
                <h2>{selectedEvent.eventType}</h2>
                <span>{selectedEvent.actor.type}</span>
              </div>
              <dl className="detail-list detail-list-grid">
                <div>
                  <dt>Project</dt>
                  <dd>{selectedEvent.projectName ?? "Organization"}</dd>
                </div>
                <div>
                  <dt>Actor</dt>
                  <dd>{selectedEvent.actor.userName ?? selectedEvent.actor.type}</dd>
                </div>
                <div>
                  <dt>Entity</dt>
                  <dd>{labelForEntityType(selectedEvent.entityType)}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatAuditTime(selectedEvent.createdAt)}</dd>
                </div>
              </dl>
              <pre>{JSON.stringify(selectedEvent.metadata, null, 2)}</pre>
            </>
          ) : (
            <div className="empty-state">Select an audit event.</div>
          )}
        </aside>
      </div>
    </>
  );
}

const entityTypeOptions: AuditEntityType[] = [
  "approval_request",
  "approval_decision",
  "policy",
  "route",
  "user_device_key",
  "agent_session",
  "local_override"
];

function formatAuditTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
