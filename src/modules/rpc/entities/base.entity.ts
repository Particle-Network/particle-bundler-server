import { BeforeInsert, BeforeUpdate, AfterLoad, AfterInsert, PrimaryGeneratedColumn, Column } from 'typeorm';

export abstract class BaseEntity<T> {
    @PrimaryGeneratedColumn()
    public id: number;

    @Column({ name: 'created_at' })
    public createdAt: Date;

    @Column({ name: 'updated_at' })
    public updatedAt: Date;

    public constructor(partial: Partial<T>) {
        Object.assign(this, partial);
    }

    @BeforeInsert()
    public beforeInsert() {
        this.createdAt = new Date();
        this.updatedAt = new Date();
    }

    @BeforeUpdate()
    public beforeUpdate() {
        this.updatedAt = new Date();
    }

    @AfterLoad()
    @AfterInsert()
    public resetType() {
        this.id = Number(this.id);
    }
}
