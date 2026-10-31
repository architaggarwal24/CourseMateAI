from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter


def load_pdf(path: str):
    """
    Loads a PDF file and returns LangChain documents.
    """
    loader = PyPDFLoader(path)
    return loader.load()


def chunk_documents(documents, chunk_size=1000, overlap=200):
    """
    Splits documents into overlapping chunks.
    """
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=overlap,
    )
    return splitter.split_documents(documents)