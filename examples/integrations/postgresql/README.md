# PostgreSQL Integration Example

This example demonstrates how to connect to and work with PostgreSQL databases in Deepnote using Python and `psycopg2`.

## What You'll Learn

- Connecting to PostgreSQL from Python
- Creating and managing database tables
- Running CRUD operations (Create, Read, Update, Delete)
- Querying data with pandas DataFrames
- Filtering and aggregating data
- Error handling and transactions

## Prerequisites

### Option 1: Quick Start with Docker (Recommended)

If you have Docker installed, start a PostgreSQL container with one command:

```bash
docker run --name deepnote-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  -d postgres:15
```

**Connection details:**
- Host: `localhost`
- Port: `5432`
- Database: `postgres`
- User: `postgres`
- Password: `postgres`

**Don't have Docker?** Install it from [docker.com](https://www.docker.com/get-started)

### Option 2: Use Existing PostgreSQL

You can connect to any existing PostgreSQL instance (local, cloud, or remote) by updating the connection parameters in the notebook.

## Setup Instructions

1. **Start PostgreSQL** (see options above)

2. **Install Python dependencies:**

   ```bash
   pip install psycopg2-binary pandas
   ```

3. **Open the notebook:**
   - Open `postgresql-example.deepnote` in VS Code with the Deepnote extension
   - Or open it in Cursor, Windsurf, or JupyterLab

4. **Update connection details:**
   - Edit the second cell with your PostgreSQL credentials
   - Default credentials work with the Docker quick start

5. **Run the cells:**
   - Execute cells sequentially using `Cmd+Enter` (Mac) or `Ctrl+Enter` (Windows)
   - The notebook creates a sample `users` table for demonstration

## What's in This Example

The notebook covers:

1. **Connection Setup** - Configure and test PostgreSQL connection
2. **Table Creation** - Create a `users` table with sample data
3. **Data Querying** - Fetch and display data using pandas
4. **Filtering** - Query specific records based on criteria
5. **Aggregation** - Calculate statistics (COUNT, AVG, MIN, MAX)
6. **Insert Operation** - Add new records to the database
7. **Update Operation** - Modify existing records
8. **Cleanup** - Drop the sample table when done

## Advanced Example

For a more complex scenario with multiple tables and relationships, see `sample_data.sql` which includes:
- Customers, products, orders, and order_items tables
- Foreign key relationships
- Sample e-commerce data
- Views for complex queries

Load it into your database:

```bash
# Docker
docker exec -i deepnote-postgres psql -U postgres < sample_data.sql

# Local PostgreSQL
psql -U postgres < sample_data.sql
```

## Cleanup

To stop and remove the Docker container:

```bash
docker stop deepnote-postgres
docker rm deepnote-postgres
```

## Troubleshooting

**`ModuleNotFoundError: No module named 'psycopg2'`**
→ Install the package: `pip install psycopg2-binary`

**Connection refused or timeout**
→ Check if PostgreSQL is running: `docker ps` or `brew services list`

**Authentication failed**
→ Verify your credentials match the database configuration

**Port already in use**
→ Change the Docker port mapping: `-p 5433:5432` (use 5433 instead of 5432)
