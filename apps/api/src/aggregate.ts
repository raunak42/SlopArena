import {
  addTotals,
  cloneTotals,
  emptyTotals,
  sortModelUsage,
  type DailyUsage,
  type DashboardData,
  type ModelUsage,
  type ProviderId,
  type ProviderSnapshot,
  type UsageSnapshot,
  type UserAggregate,
} from "@sloparena/shared";

function mergeModelLists(lists: ModelUsage[][]): ModelUsage[] {
  const modelMap = new Map<string, ModelUsage>();

  for (const list of lists) {
    for (const item of list) {
      const current = modelMap.get(item.model) ?? { model: item.model, tokens: emptyTotals() };
      addTotals(current.tokens, item.tokens);
      modelMap.set(item.model, current);
    }
  }

  return sortModelUsage([...modelMap.values()]);
}

function mergeDailyLists(lists: DailyUsage[][]): DailyUsage[] {
  const dayMap = new Map<string, { day: DailyUsage; modelLists: ModelUsage[][] }>();

  for (const list of lists) {
    for (const item of list) {
      const entry = dayMap.get(item.date) ?? {
        day: {
          date: item.date,
          totals: emptyTotals(),
          models: [],
          displayValue: 0,
        },
        modelLists: [],
      };

      addTotals(entry.day.totals, item.totals);
      entry.day.displayValue = (entry.day.displayValue ?? 0) + (item.displayValue ?? 0);
      entry.modelLists.push(item.models);
      dayMap.set(item.date, entry);
    }
  }

  return [...dayMap.values()]
    .map(({ day, modelLists }) => ({
      ...day,
      models: mergeModelLists(modelLists),
      displayValue: day.displayValue && day.displayValue > 0 ? day.displayValue : undefined,
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function mergeProviderSnapshots(provider: ProviderId, snapshots: ProviderSnapshot[]): ProviderSnapshot {
  const totals = emptyTotals();
  let sourceCount = 0;

  for (const snapshot of snapshots) {
    addTotals(totals, snapshot.totals);
    sourceCount += snapshot.sourceCount;
  }

  const byDay = mergeDailyLists(snapshots.map((snapshot) => snapshot.byDay));

  return {
    provider,
    totals,
    byModel: mergeModelLists(snapshots.map((snapshot) => snapshot.byModel)),
    byDay,
    sourceCount,
    activityDays: byDay.length,
  };
}

function getLatestSnapshots(history: UsageSnapshot[]): UsageSnapshot[] {
  const latestByMachine = new Map<string, UsageSnapshot>();

  for (const snapshot of history) {
    const key = `${snapshot.userId}::${snapshot.machineId}`;
    const existing = latestByMachine.get(key);
    if (!existing || new Date(snapshot.submittedAt).getTime() >= new Date(existing.submittedAt).getTime()) {
      latestByMachine.set(key, snapshot);
    }
  }

  return [...latestByMachine.values()];
}

function aggregateUsers(latestSnapshots: UsageSnapshot[]): UserAggregate[] {
  const users = new Map<string, { snapshots: UsageSnapshot[]; lastSubmitted: string }>();

  for (const snapshot of latestSnapshots) {
    const current = users.get(snapshot.userId) ?? { snapshots: [], lastSubmitted: snapshot.submittedAt };
    current.snapshots.push(snapshot);
    if (new Date(snapshot.submittedAt).getTime() > new Date(current.lastSubmitted).getTime()) {
      current.lastSubmitted = snapshot.submittedAt;
    }
    users.set(snapshot.userId, current);
  }

  return [...users.entries()]
    .map(([userId, value]) => {
      const providerBuckets = new Map<ProviderId, ProviderSnapshot[]>();
      const latestProfile = [...value.snapshots].sort(
        (left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime(),
      )[0]!.profile;

      for (const snapshot of value.snapshots) {
        for (const provider of snapshot.providers) {
          const bucket = providerBuckets.get(provider.provider) ?? [];
          bucket.push(provider);
          providerBuckets.set(provider.provider, bucket);
        }
      }

      const providers = [...providerBuckets.entries()]
        .map(([provider, snapshots]) => mergeProviderSnapshots(provider, snapshots))
        .sort((left, right) => right.totals.total - left.totals.total);

      return {
        userId,
        profile: latestProfile,
        machines: value.snapshots.length,
        lastSubmitted: value.lastSubmitted,
        providers,
      } satisfies UserAggregate;
    })
    .sort((left, right) => {
      const leftTotal = left.providers.reduce((sum, provider) => sum + provider.totals.total, 0);
      const rightTotal = right.providers.reduce((sum, provider) => sum + provider.totals.total, 0);
      return rightTotal - leftTotal || left.profile.handle.localeCompare(right.profile.handle);
    });
}

export function buildDashboard(history: UsageSnapshot[]): DashboardData {
  const latestSnapshots = getLatestSnapshots(history);
  const users = aggregateUsers(latestSnapshots);

  return {
    generatedAt: new Date().toISOString(),
    historyCount: history.length,
    activeUsers: users.length,
    activeMachines: latestSnapshots.length,
    users,
    recentSubmissions: [...history]
      .sort((left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime())
      .slice(0, 12)
      .map((item) => ({
        ...item,
        profile: { ...item.profile },
        providers: item.providers.map((provider) => ({
          ...provider,
          totals: cloneTotals(provider.totals),
          byModel: provider.byModel.map((model) => ({ model: model.model, tokens: cloneTotals(model.tokens) })),
          byDay: provider.byDay.map((day) => ({
            date: day.date,
            totals: cloneTotals(day.totals),
            models: day.models.map((model) => ({ model: model.model, tokens: cloneTotals(model.tokens) })),
            displayValue: day.displayValue,
          })),
        })),
      })),
  };
}
