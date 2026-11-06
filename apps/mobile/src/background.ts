/**
 * Every ~15 minutes (Android's floor), even with the app closed: reschedule reminders, raise
 * new agent alerts and refresh the widget. MagicOS may still stop it unless Sirius is exempt
 * from battery optimisation (dontkillmyapp.com/huawei).
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { clientFor, loadConnection } from './connection.ts';
import { notifyAgentEvents, syncScheduled } from './notifications.ts';
import { refreshWidget } from './widget/handler.tsx';

export const SYNC_TASK = 'sirius-sync';

TaskManager.defineTask(SYNC_TASK, async () => {
  const connection = await loadConnection();
  if (!connection) return BackgroundTask.BackgroundTaskResult.Success;
  try {
    const client = clientFor(connection);
    await Promise.all([syncScheduled(client), notifyAgentEvents(client)]);
    await refreshWidget();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    // The laptop is asleep or away: what is already scheduled still fires.
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function startBackgroundSync(): Promise<void> {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
  if (await TaskManager.isTaskRegisteredAsync(SYNC_TASK)) return;
  await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: 15 });
}
