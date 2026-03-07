export interface Flight {
  id?: number;
  user_email: string;
  flight_code: string;
  departure_city: string;
  arrival_city: string;
  departure_time: string;
  arrival_time: string;
  date: string; // YYYY-MM-DD
}

export interface SwapRequest {
  id: number;
  requester_email: string;
  flight_id: number;
  status: 'pending' | 'completed' | 'cancelled';
  created_at: string;
  flight_code: string;
  departure_city: string;
  arrival_city: string;
  date: string;
  departure_time: string;
}

export interface SwapProposal {
  id: number;
  listing_id: number;
  proposer_email: string;
  proposer_flight_id: number;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  // Joined fields
  offered_code: string;
  offered_dep: string;
  offered_arr: string;
  offered_date: string;
  my_code?: string;
  my_dep?: string;
  my_arr?: string;
  my_date?: string;
  target_code?: string;
  target_dep?: string;
  target_arr?: string;
  target_date?: string;
}
