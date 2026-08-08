export type StaffData = {
    id: string;
    full_name: string;
    status?: string | undefined;
    gender?: string | undefined;
    skills?: Record<string, any> | any;
    phone?: string | undefined;
    position?: string | undefined;
    avatar_url?: string | undefined;
    experience?: string | undefined;
};

export type TurnQueueData = {
    id?: string;
    employee_id: string;
    date: string;
    queue_position: number;
    check_in_order: number;
    status: 'waiting' | 'working' | 'assigned' | 'done_turn' | 'off';
    turns_completed: number;
    current_order_id?: string | null;
    estimated_end_time?: string | null;
    last_served_at?: string | null;
};
