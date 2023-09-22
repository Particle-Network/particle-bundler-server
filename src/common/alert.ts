class AlertService {
    private alert: IAlert;

    public setAlert(alert: IAlert) {
        this.alert = alert;
    }

    public async sendMessage(content: string, title?: string): Promise<void> {
        if (this.alert) {
            await this.alert.sendMessage(content, title);
        }
    }
}

export interface IAlert {
    sendMessage(content: string, title?: string): Promise<void>;
}

export const Alert = new AlertService();
