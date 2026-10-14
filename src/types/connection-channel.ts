export type ConnectionParticipant = {
  did: string;
  role?: string;
  status?: 'active' | 'inactive' | 'pending';
};

export type ParticipantLabel = {
  title?: string;
  description?: string;
};

export type ConnectionChannelRecord = {
  id: string; // connectionId/channelId
  subjectDid: string;
  controllerDid: string;
  participants: ConnectionParticipant[];
  labelsByParticipant?: Record<string, ParticipantLabel>;
  status?: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
};

export type ConnectionChannelQuery = {
  controllerDid?: string;
  subjectDid?: string;
  participantDid?: string;
  status?: 'active' | 'archived';
};
