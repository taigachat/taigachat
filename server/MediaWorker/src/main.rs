#[tokio::main]
async fn main() {
    media_worker_sfu::start_worker().await
}
