const API_BASE_URL = 'http://localhost:5001';

export async function analyzeBehavior(userId, sessionFeatures, register = false) {
  const response = await fetch(`${API_BASE_URL}/behavior-analysis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, sessionFeatures, register }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to submit behavior metrics');
  }

  return response.json();
}

export async function getUserProfile(userId) {
  const response = await fetch(`${API_BASE_URL}/profile/${userId}`);
  if (!response.ok) {
    if (response.status === 404) return null;
    const err = await response.json();
    throw new Error(err.error || 'Failed to fetch user profile');
  }
  return response.json();
}

export async function deleteUserProfile(userId) {
  const response = await fetch(`${API_BASE_URL}/profile/${userId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to delete user profile');
  }
  return response.json();
}
