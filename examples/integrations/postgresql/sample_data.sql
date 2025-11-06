-- Advanced PostgreSQL Sample Data
-- This file contains a more comprehensive e-commerce database example
-- Load this after running the basic tutorial in postgresql_example.deepnote

-- Clean up existing tables
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP VIEW IF EXISTS order_summary CASCADE;

-- Create customers table
CREATE TABLE customers (
    customer_id SERIAL PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    city VARCHAR(50),
    country VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create products table
CREATE TABLE products (
    product_id SERIAL PRIMARY KEY,
    product_name VARCHAR(100) NOT NULL,
    category VARCHAR(50),
    price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
    stock_quantity INTEGER DEFAULT 0 CHECK (stock_quantity >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create orders table
CREATE TABLE orders (
    order_id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(customer_id) ON DELETE CASCADE,
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'shipped', 'completed', 'cancelled')),
    total_amount DECIMAL(10, 2) CHECK (total_amount >= 0)
);

-- Create order_items table
CREATE TABLE order_items (
    order_item_id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(order_id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(product_id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10, 2) NOT NULL CHECK (unit_price >= 0),
    subtotal DECIMAL(10, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED
);

-- Insert sample customers
INSERT INTO customers (first_name, last_name, email, city, country) VALUES
    ('John', 'Doe', 'john.doe@email.com', 'New York', 'USA'),
    ('Jane', 'Smith', 'jane.smith@email.com', 'London', 'UK'),
    ('Bob', 'Johnson', 'bob.johnson@email.com', 'Toronto', 'Canada'),
    ('Alice', 'Williams', 'alice.williams@email.com', 'Sydney', 'Australia'),
    ('Charlie', 'Brown', 'charlie.brown@email.com', 'Berlin', 'Germany'),
    ('Diana', 'Davis', 'diana.davis@email.com', 'Paris', 'France'),
    ('Eva', 'Martinez', 'eva.martinez@email.com', 'Madrid', 'Spain'),
    ('Frank', 'Garcia', 'frank.garcia@email.com', 'Rome', 'Italy'),
    ('Grace', 'Lee', 'grace.lee@email.com', 'Seoul', 'South Korea'),
    ('Henry', 'Chen', 'henry.chen@email.com', 'Tokyo', 'Japan');

-- Insert sample products
INSERT INTO products (product_name, category, price, stock_quantity) VALUES
    ('Laptop Pro 15', 'Electronics', 1299.99, 50),
    ('Wireless Mouse', 'Accessories', 29.99, 200),
    ('USB-C Cable', 'Accessories', 12.99, 500),
    ('Ergonomic Desk Chair', 'Furniture', 249.99, 30),
    ('Standing Desk', 'Furniture', 599.99, 20),
    ('Notebook Set (5-pack)', 'Office Supplies', 15.99, 150),
    ('Premium Pen Pack', 'Office Supplies', 8.99, 300),
    ('Monitor 27" 4K', 'Electronics', 399.99, 40),
    ('Mechanical Keyboard RGB', 'Accessories', 149.99, 75),
    ('Noise-Canceling Headphones', 'Electronics', 89.99, 100),
    ('Webcam HD 1080p', 'Electronics', 79.99, 60),
    ('Desk Lamp LED', 'Furniture', 45.99, 80);

-- Insert sample orders
INSERT INTO orders (customer_id, order_date, status, total_amount) VALUES
    (1, '2024-10-15 10:30:00', 'completed', 1329.98),
    (2, '2024-10-16 14:20:00', 'completed', 279.98),
    (3, '2024-10-17 09:15:00', 'shipped', 599.99),
    (4, '2024-10-18 16:45:00', 'completed', 1699.97),
    (5, '2024-10-19 11:30:00', 'shipped', 44.98),
    (1, '2024-10-20 13:00:00', 'completed', 399.99),
    (6, '2024-10-21 10:00:00', 'pending', 249.99),
    (7, '2024-10-22 15:30:00', 'completed', 164.97),
    (8, '2024-10-23 12:15:00', 'shipped', 89.99),
    (9, '2024-10-24 14:00:00', 'completed', 1349.98),
    (10, '2024-10-25 09:45:00', 'completed', 295.97),
    (2, '2024-10-26 16:30:00', 'pending', 45.99),
    (3, '2024-10-27 11:20:00', 'shipped', 1579.96),
    (5, '2024-10-28 14:50:00', 'completed', 79.99);

-- Insert sample order items
INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
    -- Order 1
    (1, 1, 1, 1299.99),
    (1, 2, 1, 29.99),
    -- Order 2
    (2, 4, 1, 249.99),
    (2, 2, 1, 29.99),
    -- Order 3
    (3, 5, 1, 599.99),
    -- Order 4
    (4, 1, 1, 1299.99),
    (4, 8, 1, 399.99),
    -- Order 5
    (5, 3, 2, 12.99),
    (5, 7, 2, 8.99),
    -- Order 6
    (6, 8, 1, 399.99),
    -- Order 7
    (7, 4, 1, 249.99),
    -- Order 8
    (8, 6, 5, 15.99),
    (8, 7, 5, 8.99),
    -- Order 9
    (9, 10, 1, 89.99),
    -- Order 10
    (10, 1, 1, 1299.99),
    (10, 9, 1, 149.99),
    -- Order 11
    (11, 11, 2, 79.99),
    (11, 12, 3, 45.99),
    -- Order 12
    (12, 12, 1, 45.99),
    -- Order 13
    (13, 1, 1, 1299.99),
    (13, 9, 1, 149.99),
    (13, 2, 1, 29.99),
    (13, 11, 1, 79.99),
    -- Order 14
    (14, 11, 1, 79.99);

-- Create useful views
CREATE VIEW order_summary AS
SELECT 
    o.order_id,
    c.first_name || ' ' || c.last_name AS customer_name,
    c.email,
    c.country,
    o.order_date,
    o.status,
    COUNT(oi.order_item_id) AS total_items,
    o.total_amount
FROM orders o
JOIN customers c ON o.customer_id = c.customer_id
LEFT JOIN order_items oi ON o.order_id = oi.order_id
GROUP BY o.order_id, c.first_name, c.last_name, c.email, c.country, o.order_date, o.status, o.total_amount
ORDER BY o.order_date DESC;

CREATE VIEW product_sales AS
SELECT 
    p.product_id,
    p.product_name,
    p.category,
    p.price,
    COALESCE(SUM(oi.quantity), 0) AS total_sold,
    COALESCE(SUM(oi.subtotal), 0) AS total_revenue,
    p.stock_quantity
FROM products p
LEFT JOIN order_items oi ON p.product_id = oi.product_id
GROUP BY p.product_id, p.product_name, p.category, p.price, p.stock_quantity
ORDER BY total_revenue DESC;

-- Create indexes for better query performance
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_order_date ON orders(order_date);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);
CREATE INDEX idx_customers_email ON customers(email);

-- Print success message
DO $$
BEGIN
    RAISE NOTICE 'Sample e-commerce database created successfully!';
    RAISE NOTICE 'Tables: customers, products, orders, order_items';
    RAISE NOTICE 'Views: order_summary, product_sales';
    RAISE NOTICE 'Run SELECT * FROM order_summary; to see order details';
END $$;
